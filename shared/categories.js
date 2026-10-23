export const cardCategories = [
  "מזון וקניות", "אוכל ובילויים", "תחבורה", "בית וחשבונות", "מנויים",
  "בריאות", "ביגוד והנעלה", "חינוך וילדים", "תיירות וחופשות",
  "ביטוח ופיננסים", "ספורט ופנאי", "מתנות ותרומות", "מחשבים ואלקטרוניקה",
  "העברות ומשיכות מזומן", "כללי",
];

const categoryPalette = ["#6955df", "#d87952", "#388eab", "#8c6dcc", "#58a58b", "#ce759f", "#9b87df", "#b19545", "#5f86c6", "#9c7188", "#59a4a6", "#b08a66", "#6679ae", "#80a55b", "#a18eae", "#b8b2c8"];
export const cardCategoryColor = (name) => categoryPalette[cardCategories.indexOf(name)] || categoryPalette.at(-1);
