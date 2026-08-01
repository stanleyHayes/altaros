// Package seed builds realistic development data.
//
// The names, phone prefixes and giving amounts here are Ghanaian on purpose.
// Seed data shapes what everyone building the product looks at all day, and a
// congregation of "John Smith" on "+1 555" numbers giving "$100.00" quietly
// trains every design decision toward the wrong market — column widths sized
// for short Western names, a phone field that never sees 024 123 4567, giving
// amounts that make the E-Levy threshold look irrelevant.
package seed

// Akan day names, which most Ghanaians carry alongside a given name. The
// distribution is deliberately uneven, the way a real congregation is.
var firstNames = []string{
	"Kwame", "Ama", "Kofi", "Yaa", "Kwabena", "Abena", "Kwaku", "Akua",
	"Yaw", "Afua", "Kojo", "Adwoa", "Kwasi", "Akosua", "Kwadwo",
	"Emmanuel", "Grace", "Samuel", "Comfort", "Daniel", "Mercy", "Isaac",
	"Gifty", "Joseph", "Esther", "Michael", "Priscilla", "Nana", "Adjoa",
	"Elizabeth", "Richard", "Vida", "Prince", "Sandra", "Eric", "Cynthia",
	"Francis", "Beatrice", "Stephen", "Doris", "Ebenezer", "Rebecca",
	"Bright", "Patience", "Godfred", "Rita", "Solomon", "Naomi", "Felix",
	"Linda", "Bernard", "Juliet", "Osei", "Akosua", "Mavis", "Kingsley",
}

var lastNames = []string{
	"Owusu", "Mensah", "Boateng", "Asante", "Osei", "Adjei", "Darko",
	"Agyeman", "Amoah", "Appiah", "Frimpong", "Gyasi", "Acheampong",
	"Baffour", "Nkrumah", "Danquah", "Ofori", "Sarpong", "Yeboah",
	"Antwi", "Bediako", "Addo", "Ansah", "Quartey", "Tetteh", "Lartey",
	"Aidoo", "Kyei", "Opoku", "Bonsu", "Nyarko", "Amankwah", "Asamoah",
	"Duah", "Wiredu", "Anokye", "Twumasi", "Nti", "Bempah", "Larbi",
}

// Ghanaian mobile prefixes, by network. Real numbers cluster by network
// because people buy the network their family is on, so the seed clusters too.
var (
	mtnPrefixes        = []string{"024", "054", "055", "059"}
	telecelPrefixes    = []string{"020", "050"}
	airteltigoPrefixes = []string{"027", "057", "026"}
)

// phoneFormats are the ways a church secretary actually types a number into a
// spreadsheet. Seeding through them exercises the E.164 normalisation in
// WP-12 rather than assuming it — if the seed produces clean data, the import
// path is never tested by anything a person looks at.
var phoneFormats = []string{
	"0%s%s",    // 0241234567
	"0%s %s",   // 024 1234567
	"0%s-%s",   // 024-1234567
	"+233%s%s", // +233241234567 (leading 0 stripped by the caller)
	"233%s%s",  // 233241234567
	"(0%s) %s", // (024) 1234567
}

var streets = []string{
	"Oxford Street", "Spintex Road", "Liberation Road", "Ring Road Central",
	"Independence Avenue", "Kwame Nkrumah Avenue", "Adenta-Dodowa Road",
	"Achimota Mile 7", "Lapaz Junction", "East Legon Boulevard",
}

// departments a Ghanaian church actually runs.
var departments = []string{
	"Choir", "Ushering", "Media & Sound", "Children's Ministry",
	"Youth Ministry", "Women's Fellowship", "Men's Fellowship",
	"Evangelism", "Prayer Team", "Welfare", "Protocol", "Sanitation",
}

// noteworthy giving descriptions, so the ledger reads like a church's rather
// than like a test fixture.
var offeringNotes = []string{
	"Sunday first service",
	"Sunday second service",
	"Midweek service",
	"Thanksgiving service",
	"Watch night",
	"Harvest",
	"Special offering",
}

var expenseNotes = []string{
	"Generator fuel",
	"PA system repair",
	"Guest minister honorarium",
	"Children's ministry materials",
	"Building fund — roofing sheets",
	"Utility bill (ECG)",
	"Water (GWCL)",
	"Transport for outreach",
	"Printing — Sunday bulletins",
	"Welfare support — bereaved family",
}
