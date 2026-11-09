import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SOUNDS, androidKeyOf } from "../src/models";

const root = process.env.SF_ROOT ?? path.resolve(__dirname, "../.."); // SF_ROOT: when the tests run in a copy of functions/

describe("the one list of sounds", () => {
  it("every jingle of the list is a file in the app's sounds folder, and every file is in the list", () => {
    const files = fs.readdirSync(path.join(root, "frontend/public/sounds")).filter((f) => /\.(mp3|wav|ogg|m4a|aac)$/i.test(f)).sort();
    const listed = SOUNDS.filter((s) => s.kind === "jingle").map((s) => s.id.slice("file:".length)).sort();
    expect(listed).toEqual(files);
  });

  it("every jingle has its Android file res/raw/<key>.mp3 and the generated SoundIds.java is current", () => {
    for (const sound of SOUNDS.filter((s) => s.kind === "jingle")) {
      expect(fs.existsSync(path.join(root, `android/app/src/main/res/raw/${sound.androidKey}.mp3`))).toBe(true);
    }
    const java = fs.readFileSync(path.join(root, "android/app/src/main/java/io/sevenfriends/app/SoundIds.java"), "utf8");
    for (const sound of SOUNDS.filter((s) => s.kind === "jingle")) expect(java).toContain(`"${sound.id}"`);
  });

  it("the channel key of a choice: silent, a jingle, or the phone's own sound", () => {
    expect(androidKeyOf("none")).toBe("silent");
    expect(androidKeyOf("file:SevenFriends_raw3_AcidBreaks.mp3")).toBe("acidbreaks");
    expect(androidKeyOf("ding")).toBe("default");
    expect(androidKeyOf("file:Unknown.mp3")).toBe("default");
    expect(androidKeyOf(null)).toBe("default");
    expect(androidKeyOf("file:Acid_Breaks.mp3")).toBe("acidbreaks"); // saved under an older file name: still found
    expect(androidKeyOf("file:Hyper-old.wav")).toBe("hyper");
  });
});
