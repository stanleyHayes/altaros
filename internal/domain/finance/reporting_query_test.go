package finance

import (
	"reflect"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestOwnerHistoryIncludesAttributedAndPrivateAnonymousRows(t *testing.T) {
	filter := (Query{OwnerID: "member_1"}).filter()
	want := bson.A{
		bson.M{"memberId": "member_1"},
		bson.M{"initiatedBy": "member_1"},
	}
	if !reflect.DeepEqual(filter["$or"], want) {
		t.Fatalf("owner filter = %#v, want %#v", filter["$or"], want)
	}
}
