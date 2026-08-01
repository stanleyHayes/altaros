package mongodb

import (
	"encoding/json"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// ID bridges a real interoperability gap between the Go services and the
// legacy TypeScript API, which share one database during the migration
// (ADR-005).
//
// Mongoose declares reference fields as Schema.Types.ObjectId, so churchId is
// stored as a BSON ObjectId. The shared-types contract the frontends consume
// declares `churchId: string`. Modelling the Go field as a plain string fails
// to decode ("cannot decode objectID into a string"), and modelling it as
// bson.ObjectID changes the JSON the frontends receive from a string to an
// object. Neither is acceptable.
//
// ID resolves that: it reads either representation from BSON, writes ObjectId
// back so documents stay compatible with the TypeScript schema, and is always
// a plain string over JSON.
type ID string

// String returns the hex form.
func (id ID) String() string { return string(id) }

// IsZero reports whether the id is unset.
func (id ID) IsZero() bool { return id == "" }

// ObjectID converts to a driver ObjectID for use in filters.
func (id ID) ObjectID() (bson.ObjectID, error) {
	return bson.ObjectIDFromHex(string(id))
}

// UnmarshalBSONValue accepts an ObjectId (what Mongoose writes), a string
// (what a Go-native document would write), or null.
func (id *ID) UnmarshalBSONValue(typ byte, data []byte) error {
	rv := bson.RawValue{Type: bson.Type(typ), Value: data}

	switch bson.Type(typ) {
	case bson.TypeObjectID:
		oid, ok := rv.ObjectIDOK()
		if !ok {
			return fmt.Errorf("mongodb: malformed ObjectId for ID")
		}
		*id = ID(oid.Hex())
		return nil

	case bson.TypeString:
		s, ok := rv.StringValueOK()
		if !ok {
			return fmt.Errorf("mongodb: malformed string for ID")
		}
		*id = ID(s)
		return nil

	case bson.TypeNull, bson.TypeUndefined:
		*id = ""
		return nil

	default:
		return fmt.Errorf("mongodb: cannot decode BSON type %v into ID", bson.Type(typ))
	}
}

// MarshalBSONValue writes an ObjectId when the value is a valid hex id, so
// documents written by Go remain readable by the Mongoose schema. A non-hex
// value is written as a string rather than silently dropped.
func (id ID) MarshalBSONValue() (byte, []byte, error) {
	if id == "" {
		return byte(bson.TypeNull), nil, nil
	}
	if oid, err := bson.ObjectIDFromHex(string(id)); err == nil {
		typ, data, err := bson.MarshalValue(oid)
		return byte(typ), data, err
	}
	typ, data, err := bson.MarshalValue(string(id))
	return byte(typ), data, err
}

// MarshalJSON keeps the wire contract a plain string, matching shared-types.
func (id ID) MarshalJSON() ([]byte, error) { return json.Marshal(string(id)) }

// UnmarshalJSON reads a plain string.
func (id *ID) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	*id = ID(s)
	return nil
}
