import { expect, type Page } from "@playwright/test";

/** The page must never scroll sideways (phones included). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Open Analyze, load the sample text and analyze it. */
export async function analyzeSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Use sample text" }).click();
  await page.getByRole("button", { name: "Analyze" }).click();
}

/** Go to a page through the main menu: open the drawer, then pick the page. */
export async function openFromMenu(page: Page, name: string | RegExp) {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).click();
}

/** Fail the test on any uncaught error in the page. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return () => expect(errors, errors.join("\n")).toEqual([]);
}
