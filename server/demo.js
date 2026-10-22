import { randomUUID } from "node:crypto";
import { importAccounts } from "./store.js";
export function demoAccounts(provider) {
  const now = new Date();
  const date = (month, day) =>
    new Date(
      Date.UTC(now.getFullYear(), now.getMonth() - month, day),
    ).toISOString();
  const bank = provider === "hapoalim";
  const entries = bank
    ? [
        ["משכורת · סטודיו אלמנט", 18400, 1, 0],
        ["העברה לשכר דירה", -6200, 2, 0],
        ["חברת החשמל", -386.4, 4, 0],
        ["העברה נכנסת", 1250, 6, 0],
        ["בזק · אינטרנט", -119, 9, 0],
      ]
    : [
        ["שופרסל דיל", -342.9, 3, 0],
        ["Wolt · ארוחת ערב", -128, 5, 0],
        ["קפה נורדוי", -54, 6, 0],
        ["Spotify Premium", -21.9, 7, 0],
        ["סונול · תל אביב", -256, 8, 0],
        ["רמי לוי", -284.5, 10, 0],
        ["Netflix", -54.9, 11, 0],
        ["רכבת ישראל", -36, 12, 0],
        ["מסעדת האחים", -238, 13, 0],
        ["AM:PM", -87.6, 14, 0],
        ["פנגו", -24.8, 15, 0],
        ["ארומה", -46, 16, 0],
        ["זיכוי · קנייה באינטרנט", 129, 17, 0],
        ["סופר פארם", -152.4, 18, 0],
        ["Wolt · צהריים", -89, 19, 0],
      ];
  const txns = [];
  for (let m = 5; m >= 0; m--) {
    for (const [description, amount, day] of entries) {
      if (m === 0 && day > now.getDate()) continue;
      const factor = m ? 0.85 + ((m * 7 + day) % 5) / 10 : 1;
      txns.push({
        identifier: `demo-${provider}-${m}-${day}`,
        date: date(m, day),
        processedDate: !bank && m === 0 ? date(-1, 10) : date(m, day),
        description,
        chargedAmount: Math.round(amount * factor * 100) / 100,
        originalAmount: amount,
        originalCurrency: "ILS",
        status:
          m === 0 && day === Math.min(now.getDate(), 19)
            ? "pending"
            : "completed",
      });
    }
  }
  return [
    {
      accountNumber: bank ? "456789" : "4580",
      balance: bank ? 32845.7 : undefined,
      currency: "ILS",
      txns,
    },
  ];
}
export function seedDemo(store, userId) {
  for (const [provider, name] of [
    ["hapoalim", "החשבון האישי"],
    ["max", "כרטיס האשראי שלי"],
    ["oneZero", "חשבון משותף · הדגמת אימות"],
  ]) {
    const id = randomUUID();
    store.db
      .prepare(
        "INSERT INTO connections(id,user_id,provider,name,synced_at) VALUES(?,?,?,?,?)",
      )
      .run(
        id,
        userId,
        provider,
        name,
        provider === "oneZero" ? null : new Date().toISOString(),
      );
    if (provider !== "oneZero")
      importAccounts(store, id, demoAccounts(provider));
  }
}
