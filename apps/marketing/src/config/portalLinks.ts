const trimSlash = (value: string) => value.replace(/\/$/, "");

export const CHURCH_APP_URL = trimSlash(
  import.meta.env.VITE_CHURCH_APP_URL || "https://dashboard.altaros.io",
);

export const MEMBER_WEB_URL = trimSlash(
  import.meta.env.VITE_MEMBER_WEB_URL || "https://app.altaros.io",
);

export const portalLinks = {
  churchLogin: `${CHURCH_APP_URL}/login`,
  churchRegister: `${CHURCH_APP_URL}/register`,
  memberLogin: `${MEMBER_WEB_URL}/login`,
  memberRegister: `${MEMBER_WEB_URL}/register`,
};
