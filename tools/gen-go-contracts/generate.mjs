#!/usr/bin/env node
/**
 * Generates Go contract types from packages/shared-types (WP-04).
 *
 * Why this exists: the login outage in this repo was caused by hand-maintained
 * duplicate types. `shared-types` declared LoginRequest with a required
 * `method`, the dashboard declared its own copy without it, and every login
 * returned 400. Generating the Go side from the same source makes that class
 * of drift a build failure instead of a production bug.
 *
 * Scope: these are WIRE types (DTOs) — what crosses the HTTP boundary. TS
 * `number` becomes Go `float64` because that is genuinely what a JSON number
 * is. Persistence types are separate and store money as integer minor units
 * per ADR-005; do not persist these structs directly for monetary values.
 *
 *   node tools/gen-go-contracts/generate.mjs [--check]
 *
 * --check regenerates into memory and exits non-zero if the committed output
 * differs, which is what CI runs.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// TypeScript 7 (the Go rewrite) no longer exposes createProgram from its main
// entry — only ./unstable/*. This tool pins its own TypeScript 5 for the
// stable compiler API; it is build-time only and does not affect the apps.
const require = createRequire(import.meta.url);
const ts = require("typescript");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SRC_DIR = path.join(REPO, "packages/shared-types/src");
const OUT_DIR = path.join(REPO, "internal/contracts");
const PACKAGE = "contracts";

const checkOnly = process.argv.includes("--check");

/** Names that must not be treated as generated types. */
const SKIP_FILES = new Set(["index.ts"]);

const warnings = [];

/**
 * Property and type names via the node's own text. `getText()` requires the
 * node to be bound to a source file, which is not guaranteed while walking
 * declarations, so read `.text`/`.escapedText` first.
 */
function textOf(node) {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (typeof node.escapedText === "string") return node.escapedText;
  if (ts.isQualifiedName?.(node)) return textOf(node.right);
  try {
    return node.getText();
  } catch {
    return "";
  }
}

/**
 * Formats Go source with gofmt. Applied to generated content in BOTH the
 * write and --check paths; formatting only on write made --check compare
 * unformatted text against formatted files and report drift every run.
 */
function gofmt(content, label) {
  try {
    return execFileSync("gofmt", [], { input: content, encoding: "utf8" });
  } catch (err) {
    warnings.push(`${label}: gofmt failed (${err.message}); left unformatted`);
    return content;
  }
}

// --- naming -----------------------------------------------------------------

/** TS member name -> exported Go field name. */
function goFieldName(name) {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, " ");
  const pascal = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      // SCREAMING_CASE enum members would otherwise become SUPERADMIN;
      // lowercase the tail so they read as SuperAdmin.
      w.length > 1 && w === w.toUpperCase()
        ? w[0] + w.slice(1).toLowerCase()
        : w[0].toUpperCase() + w.slice(1),
    )
    .join("");
  // Go initialisms read wrong otherwise: Id -> ID, Url -> URL.
  return pascal
    .replace(/Id\b/g, "ID")
    .replace(/Url\b/g, "URL")
    .replace(/Api\b/g, "API")
    .replace(/Sms\b/g, "SMS")
    .replace(/Ussd\b/g, "USSD")
    .replace(/Otp\b/g, "OTP")
    .replace(/Ai\b/g, "AI");
}

function goTypeName(name) {
  return name[0].toUpperCase() + name.slice(1);
}

// --- type mapping -----------------------------------------------------------

/**
 * Maps a TS type node to a Go type string.
 * `known` is the set of type names generated in this run, so references
 * resolve to real Go types rather than `any`.
 */
function goType(node, known, context) {
  if (!node) return "any";

  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return "string";
    case ts.SyntaxKind.BooleanKeyword:
      return "bool";
    case ts.SyntaxKind.NumberKeyword:
      // A JSON number is an IEEE-754 double. Money is handled by the
      // persistence layer as integer minor units (ADR-005).
      return "float64";
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return "any";
  }

  if (ts.isArrayTypeNode(node)) {
    return "[]" + goType(node.elementType, known, context);
  }

  if (ts.isTypeReferenceNode(node)) {
    const name = textOf(node.typeName);
    if (name === "Date") return "time.Time";
    if (name === "Array" && node.typeArguments?.length === 1) {
      return "[]" + goType(node.typeArguments[0], known, context);
    }
    if (name === "Record" && node.typeArguments?.length === 2) {
      const k = goType(node.typeArguments[0], known, context);
      const v = goType(node.typeArguments[1], known, context);
      return `map[${k}]${v}`;
    }
    if (name === "Partial" && node.typeArguments?.length === 1) {
      // Partial<T> loses per-field optionality in Go; surface it rather than
      // silently emitting a type with the wrong nullability.
      warnings.push(`${context}: Partial<> flattened to its base type`);
      return goType(node.typeArguments[0], known, context);
    }
    if (known.has(name)) return goTypeName(name);
    warnings.push(`${context}: unresolved type reference '${name}' -> any`);
    return "any";
  }

  if (ts.isUnionTypeNode(node)) {
    const parts = node.types.filter(
      (t) =>
        t.kind !== ts.SyntaxKind.NullKeyword &&
        t.kind !== ts.SyntaxKind.UndefinedKeyword,
    );
    // A union of string literals is a string-typed enum.
    if (parts.every((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))) {
      return "string";
    }
    if (parts.length === 1) return goType(parts[0], known, context);
    warnings.push(`${context}: heterogeneous union -> any`);
    return "any";
  }

  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    return "string";
  }

  if (ts.isTypeLiteralNode(node)) {
    // Inline object literal: emit an anonymous struct so the shape survives.
    const fields = node.members
      .filter(ts.isPropertySignature)
      .map((m) => {
        const jsonName = textOf(m.name);
        const optional = Boolean(m.questionToken);
        const gt = goType(m.type, known, `${context}.${jsonName}`);
        const tag = optional ? `${jsonName},omitempty` : jsonName;
        return `\t\t${goFieldName(jsonName)} ${optional && !gt.startsWith("[]") && !gt.startsWith("map[") ? "*" : ""}${gt} \`json:"${tag}"\``;
      })
      .join("\n");
    return `struct {\n${fields}\n\t}`;
  }

  warnings.push(`${context}: unsupported type kind ${ts.SyntaxKind[node.kind]} -> any`);
  return "any";
}

// --- emitters ---------------------------------------------------------------

function emitInterface(decl, known) {
  const name = goTypeName(decl.name.text);
  const lines = [];
  const doc = jsDocOf(decl);
  if (doc) lines.push(doc);
  lines.push(`type ${name} struct {`);

  for (const member of decl.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const jsonName = textOf(member.name);
    const optional = Boolean(member.questionToken);
    const gt = goType(member.type, known, `${name}.${jsonName}`);

    // Pointers preserve the null-vs-absent distinction for optional scalars;
    // slices and maps are already nilable.
    const pointer =
      optional && !gt.startsWith("[]") && !gt.startsWith("map[") && gt !== "any";
    const tag = optional ? `${jsonName},omitempty` : jsonName;

    const memberDoc = jsDocOf(member);
    if (memberDoc) lines.push("\t" + memberDoc.replace(/\n/g, "\n\t"));
    lines.push(`\t${goFieldName(jsonName)} ${pointer ? "*" : ""}${gt} \`json:"${tag}"\``);
  }

  lines.push("}");
  return lines.join("\n");
}

function emitEnum(decl) {
  const name = goTypeName(decl.name.text);
  const lines = [];
  const doc = jsDocOf(decl);
  if (doc) lines.push(doc);
  lines.push(`type ${name} string`);
  lines.push("");
  lines.push("const (");
  for (const m of decl.members) {
    const memberName = textOf(m.name);
    const value = m.initializer && ts.isStringLiteral(m.initializer)
      ? m.initializer.text
      : memberName;
    lines.push(`\t${name}${goFieldName(memberName)} ${name} = ${JSON.stringify(value)}`);
  }
  lines.push(")");
  return lines.join("\n");
}

/** A `type X = "a" | "b"` alias becomes a Go string type plus constants. */
function emitStringUnionAlias(decl) {
  const name = goTypeName(decl.name.text);
  const values = decl.type.types
    .filter((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
    .map((t) => t.literal.text);

  const lines = [];
  const doc = jsDocOf(decl);
  if (doc) lines.push(doc);
  lines.push(`type ${name} string`);
  lines.push("");
  lines.push("const (");
  for (const v of values) {
    lines.push(`\t${name}${goFieldName(v)} ${name} = ${JSON.stringify(v)}`);
  }
  lines.push(")");
  return lines.join("\n");
}

function jsDocOf(node) {
  const docs = node.jsDoc;
  if (!docs || docs.length === 0) return "";
  const text = docs
    .map((d) => (typeof d.comment === "string" ? d.comment : ""))
    .join(" ")
    .trim();
  if (!text) return "";
  return text
    .split("\n")
    .map((l) => `// ${l.trim()}`)
    .join("\n");
}

// --- driver -----------------------------------------------------------------

function collect() {
  const files = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".ts") && !SKIP_FILES.has(f))
    .sort();

  const program = ts.createProgram(
    files.map((f) => path.join(SRC_DIR, f)),
    { target: ts.ScriptTarget.ES2022, strict: true, noEmit: true },
  );

  // First pass: every exported type name, so cross-file references resolve.
  const known = new Set();
  for (const file of files) {
    const sf = program.getSourceFile(path.join(SRC_DIR, file));
    ts.forEachChild(sf, (node) => {
      if (
        (ts.isInterfaceDeclaration(node) ||
          ts.isEnumDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)) &&
        node.name
      ) {
        known.add(node.name.text);
      }
    });
  }

  const outputs = new Map();
  for (const file of files) {
    const sf = program.getSourceFile(path.join(SRC_DIR, file));
    const blocks = [];

    ts.forEachChild(sf, (node) => {
      if (ts.isInterfaceDeclaration(node)) {
        blocks.push(emitInterface(node, known));
      } else if (ts.isEnumDeclaration(node)) {
        blocks.push(emitEnum(node));
      } else if (ts.isTypeAliasDeclaration(node)) {
        if (
          ts.isUnionTypeNode(node.type) &&
          node.type.types.every(
            (t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal),
          )
        ) {
          blocks.push(emitStringUnionAlias(node));
        } else {
          const alias = goType(node.type, known, node.name.text);
          blocks.push(`type ${goTypeName(node.name.text)} = ${alias}`);
        }
      }
    });

    if (blocks.length === 0) continue;

    const needsTime = blocks.some((b) => b.includes("time.Time"));
    const header = [
      "// Code generated by tools/gen-go-contracts. DO NOT EDIT.",
      "//",
      `// Source: packages/shared-types/src/${file}`,
      "//",
      "// Wire (DTO) types shared with the TypeScript frontends. Regenerate with",
      "// `make contracts` after changing shared-types; CI fails on drift.",
      "",
      `package ${PACKAGE}`,
      "",
    ];
    if (needsTime) header.push('import "time"', "", "");

    const outName = file.replace(/\.ts$/, ".gen.go");
    outputs.set(outName, gofmt(header.join("\n") + blocks.join("\n\n") + "\n", outName));
  }

  return outputs;
}

function main() {
  const outputs = collect();

  if (checkOnly) {
    let drifted = [];
    for (const [name, content] of outputs) {
      const target = path.join(OUT_DIR, name);
      if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
        drifted.push(name);
      }
    }
    if (drifted.length > 0) {
      console.error(
        "contract drift: shared-types changed without regenerating Go types.\n" +
          "Out of date: " + drifted.join(", ") + "\n" +
          "Run `make contracts` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`contracts up to date (${outputs.size} files)`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Remove stale output so a deleted shared-types module doesn't leave a
  // phantom Go file behind.
  for (const existing of fs.readdirSync(OUT_DIR)) {
    if (existing.endsWith(".gen.go") && !outputs.has(existing)) {
      fs.unlinkSync(path.join(OUT_DIR, existing));
    }
  }
  for (const [name, content] of outputs) {
    fs.writeFileSync(path.join(OUT_DIR, name), content);
  }


  console.log(`generated ${outputs.size} Go contract files into internal/contracts`);
  if (warnings.length > 0) {
    const unique = [...new Set(warnings)];
    console.log(`\n${unique.length} mapping note(s):`);
    for (const w of unique) console.log("  - " + w);
  }
}

main();
