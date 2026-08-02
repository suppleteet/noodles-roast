import { describe, expect, it } from "vitest";
import {
  classifyClearYesNoAnswer,
  isGenuinelyYesNoQuestion,
} from "@/lib/yesNoBranching";

describe("yes/no branching", () => {
  it("recognizes authored and elliptical binary questions", () => {
    expect(isGenuinelyYesNoQuestion("Are you single?")).toBe(true);
    expect(isGenuinelyYesNoQuestion("Okay. You actually married?")).toBe(true);
    expect(isGenuinelyYesNoQuestion("Do you work from home?")).toBe(true);
  });

  it("rejects open and either-or questions", () => {
    expect(isGenuinelyYesNoQuestion("Where are you from?")).toBe(false);
    expect(isGenuinelyYesNoQuestion("Are you single or married?")).toBe(false);
    expect(isGenuinelyYesNoQuestion("What do you do for fun?")).toBe(false);
  });

  it("classifies explicit natural answers", () => {
    expect(classifyClearYesNoAnswer("Yeah, I am.")) .toBe("yes");
    expect(classifyClearYesNoAnswer("Uh-huh.")) .toBe("yes");
    expect(classifyClearYesNoAnswer("Nope, I'm not.")) .toBe("no");
    expect(classifyClearYesNoAnswer("Not really.")) .toBe("no");
  });

  it("does not force uncertain or contradictory replies", () => {
    expect(classifyClearYesNoAnswer("Maybe, it depends.")) .toBeNull();
    expect(classifyClearYesNoAnswer("Yes and no.")) .toBeNull();
    expect(classifyClearYesNoAnswer("Yeah—no, actually.")) .toBeNull();
    expect(classifyClearYesNoAnswer("I have a complicated answer.")) .toBeNull();
    expect(classifyClearYesNoAnswer("Yeah, I have two kids.")) .toBeNull();
  });
});
