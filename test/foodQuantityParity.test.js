// The meal card rescales a row by the ratio of two weights on the client, and the
// server recomputes the same row from the same two amounts after the PUT. Both sides
// must read an amount identically, so the client's quantityOf (meal-card-model.ts)
// and the server's parseFoodQuantity (src/foodCapture.ts) run over ONE fixture table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadClientModule } from "./_dom.mjs";
import { parseFoodQuantity } from "../dist/foodCapture.js";

const plain = (value) => JSON.parse(JSON.stringify(value));

const AMOUNTS = [
  "205 g",
  "205g",
  "1,5 kg",
  "0.2 kg",
  "6 oz",
  "8 oz chicken",
  "~1/2 lb",
  "about 150g",
  "approx. 3 ounces",
  "around 2 pounds",
  "200 g cooked",
  "1 kilogram",
  "250 ml",
  "1.5 l",
  "2 litres",
  "500 milliliters",
  "2 eggs",
  "1 egg",
  "3 slices",
  "2 tsp",
  "1 tbsp olive oil",
  "1/4 cup",
  "4",
  "0 g",
  "-5 g",
  "a handful",
  "",
  null,
  undefined,
  "  12  G  ",
];

test("the client and the server read every amount identically", () => {
  const M = loadClientModule(["meal-card-model"]).CairnMealCardModel;
  for (const amount of AMOUNTS) {
    const server = parseFoodQuantity(amount);
    assert.deepEqual(plain(M.quantityOf(amount)), plain(server), `quantity of ${JSON.stringify(amount)}`);
    const grams = server?.unit === "g" ? server.value : null;
    assert.equal(M.gramsFromAmount(amount), grams, `grams in ${JSON.stringify(amount)}`);
  }
});
