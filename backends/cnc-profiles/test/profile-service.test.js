import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProfileDatabase } from "../src/db/profile-db.js";
import { ProfileService } from "../src/services/profile-service.js";

test("HELP status banner is owner-only until manually selected", async () => {
  const { database, service } = await createService();

  const ownerBeforeSelection = service.getMe("NeedsAdvice");
  const statusBanner = ownerBeforeSelection.banners.find((banner) => banner.id === "status-help");

  assert.deepEqual(statusBanner, {
    id: "status-help",
    title: "HELP! (Status)",
    url: "",
    detail: { value: "Please advice me!" },
    usernameStyle: {
      id: "status-help",
      data: { label: "HELP" }
    }
  });
  assert.equal(ownerBeforeSelection.currentBannerId, null);
  assert.equal(ownerBeforeSelection.selectionMode, "auto");
  assert.equal(database.getProfile("NeedsAdvice").banners["status-help"], undefined);

  const publicBeforeSelection = service.getPublicProfile("NeedsAdvice");
  assert.equal(publicBeforeSelection.banners.some((banner) => banner.id === "status-help"), false);
  assert.equal(getBatchProfile(service, "NeedsAdvice").banners.some((banner) => banner.id === "status-help"), false);

  const ownerAfterSelection = await service.setCurrentBanner("NeedsAdvice", "status-help");
  assert.equal(ownerAfterSelection.currentBannerId, "status-help");
  assert.deepEqual(ownerAfterSelection.currentBanner, statusBanner);
  assert.equal(ownerAfterSelection.selectionMode, "manual");
  assert.equal(database.getProfile("NeedsAdvice").sources["status-help"].source, "self-service:status");

  database.getProfile("NeedsAdvice").banners["status-help"].title = "Legacy HELP banner";
  delete database.getProfile("NeedsAdvice").banners["status-help"].detail;

  const publicAfterSelection = service.getPublicProfile("NeedsAdvice");
  assert.equal(publicAfterSelection.currentBannerId, "status-help");
  assert.deepEqual(publicAfterSelection.banners, [statusBanner]);
  assert.deepEqual(getBatchProfile(service, "NeedsAdvice").currentBanner, statusBanner);

  await service.setCurrentBanner("NeedsAdvice", null);

  const ownerAfterClearing = service.getMe("NeedsAdvice");
  assert.equal(ownerAfterClearing.banners.some((banner) => banner.id === "status-help"), true);
  assert.equal(ownerAfterClearing.currentBannerId, null);
  assert.equal(service.getPublicProfile("NeedsAdvice").banners.some((banner) => banner.id === "status-help"), false);
  assert.equal(getBatchProfile(service, "NeedsAdvice").banners.some((banner) => banner.id === "status-help"), false);
});

async function createService() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cnc-profiles-service-"));
  const database = new ProfileDatabase(path.join(directory, "profiles.json"));
  await database.init();
  return {
    database,
    service: new ProfileService({ database })
  };
}

function getBatchProfile(service, username) {
  const result = service.getBatchProfiles([{ username }]);
  assert.equal(result.profiles.length, 1);
  return result.profiles[0];
}
