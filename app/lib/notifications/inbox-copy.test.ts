import { describe, expect, it } from "vitest";
import { splitInboxBody } from "./inbox-copy";

describe("reading the headline and detail line from an inbox item's body", () => {
  it("takes the first paragraph as the headline and the next as the detail line", () => {
    expect(
      splitInboxBody(
        'We approved your refund request\n\nIntro to Testing · "Within the refund window."\n'
      )
    ).toEqual({
      headline: "We approved your refund request",
      detail: 'Intro to Testing · "Within the refund window."',
    });
  });

  it("has an empty detail line when the body is only a headline", () => {
    expect(splitInboxBody("We declined your refund request")).toEqual({
      headline: "We declined your refund request",
      detail: "",
    });
  });

  it("accepts Windows line endings", () => {
    expect(splitInboxBody("Headline\r\n\r\nDetail")).toEqual({
      headline: "Headline",
      detail: "Detail",
    });
  });
});
