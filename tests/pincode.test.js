require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { lookupPincode, stateFromPrefix, knownState } = require("../services/pincodeService");

const reply = (body, ok = true) => async () => ({ ok, json: async () => body });

test("the state comes from the PIN code's postal circle", () => {
  assert.equal(stateFromPrefix("560038"), "Karnataka");
  assert.equal(stateFromPrefix("110001"), "Delhi");
  assert.equal(stateFromPrefix("403001"), "Goa");        // three-digit circle inside Maharashtra's 40
  assert.equal(stateFromPrefix("400001"), "Maharashtra");
  assert.equal(stateFromPrefix("605001"), "Puducherry");
  assert.equal(stateFromPrefix("194101"), "Ladakh");
  assert.equal(stateFromPrefix("834001"), "Jharkhand");
  assert.equal(stateFromPrefix("999999"), "");           // Army Post Office: no state
});

test("India Post's spellings are matched to the address form's state list", () => {
  assert.equal(knownState("NCT of Delhi"), "Delhi");
  assert.equal(knownState("Jammu & Kashmir"), "Jammu and Kashmir");
  assert.equal(knownState("karnataka"), "Karnataka");
  assert.equal(knownState("Atlantis"), "");
});

test("a PIN code lookup fills the town and state from India Post", async () => {
  const fetchImpl = reply([{ Status: "Success", PostOffice: [{ District: "BANGALORE", State: "Karnataka" }] }]);
  assert.deepEqual(await lookupPincode("560001", { fetchImpl, remote: true }), { pincode: "560001", city: "Bangalore", state: "Karnataka", source: "post" });
});

test("when India Post fails or doesn't know the PIN code, the state still comes from its first digits", async () => {
  const failing = async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); };
  assert.deepEqual(await lookupPincode("600002", { fetchImpl: failing, remote: true }), { pincode: "600002", city: "", state: "Tamil Nadu", source: "prefix" });
  const unknown = reply([{ Status: "Error", PostOffice: null }]);
  assert.equal((await lookupPincode("700002", { fetchImpl: unknown, remote: true })).state, "West Bengal");
  const down = reply({}, false);
  assert.equal((await lookupPincode("380002", { fetchImpl: down, remote: true })).source, "prefix");
});

test("a malformed PIN code is refused, and tests never call India Post", async () => {
  assert.equal(await lookupPincode("12345"), null);
  assert.equal(await lookupPincode("012345"), null);
  let called = false;
  const spy = async () => { called = true; return { ok: true, json: async () => [] }; };
  await lookupPincode("411001", { fetchImpl: spy });
  assert.equal(called, false, "NODE_ENV=test keeps lookups offline by default");
});
