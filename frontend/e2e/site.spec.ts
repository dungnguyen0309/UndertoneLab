import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { analyzeSample, expectNoHorizontalScroll } from "./helpers";

test("the API is healthy and has UN data", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ status: "ok", database: "ok" });
  expect(body.un_data.statements).toBeGreaterThan(0);
});

test("the API documentation loads", async ({ request }) => {
  expect((await request.get("/api/docs")).status()).toBe(200);
  const schema = await (await request.get("/api/openapi.json")).json();
  expect(Object.keys(schema.paths)).toContain("/api/analyze");
});

test("unknown API paths answer with JSON, unknown pages with the app", async ({ page, request }) => {
  const api = await request.get("/api/does-not-exist");
  expect(api.status()).toBe(404);
  expect((await api.json()).detail).toContain("No API endpoint");
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

for (const path of ["/", "/un", "/datasets", "/dictionaries", "/method"]) {
  test(`page ${path} opens directly and fits the screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // On phones the main menu sits behind the Menu button
    await expect(page.getByRole("navigation", { name: "Main" }).or(page.getByRole("button", { name: "Menu" }))).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}

test("the mouse wheel glides the page to a stop, but a scroll box under the pointer scrolls itself", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones scroll by touch, which stays native");
  await page.goto("/method");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // every position the page passes through, timed in the page itself
  await page.evaluate(() => {
    const trail: number[][] = [];
    Object.assign(window, { trail });
    addEventListener("scroll", () => trail.push([performance.now(), scrollY]));
  });
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(400);
  const trail = await page.evaluate(() => (window as unknown as { trail: number[][] }).trail);
  expect(trail.length).toBeGreaterThan(10);                                   // a glide, not a jump
  expect(trail[trail.length - 1][0] - trail[0][0]).toBeGreaterThan(350);

  await page.evaluate(() => {
    const box = Object.assign(document.createElement("div"), { id: "box", innerHTML: "<div style='height:1000px'></div>" });
    box.style.cssText = "position:fixed;left:0;top:200px;width:300px;height:150px;overflow:auto";
    document.body.append(box);
  });
  await page.mouse.move(100, 260);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => document.getElementById("box")!.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(400);

  // with Shift held the wheel stays the browser's (a sideways scroll), so the page does not glide down
  await page.mouse.move(400, 500);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 300);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => scrollY)).toBe(400);
});

// Automatic accessibility checks (WCAG 2.2 A and AA) on every page, in light and dark mode
for (const scheme of ["light", "dark"] as const) {
  test(`every page passes the accessibility checks (${scheme})`, async ({ page }) => {
    // reduced motion: contrast is checked on the settled page, not halfway through a block rising in
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const check = async (name: string) => {
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(violations.map((v) => `${name}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
    };
    for (const path of ["/", "/un", "/datasets", "/dictionaries", "/dictionaries?v=counts", "/method"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await check(path);
    }
    await analyzeSample(page);
    await expect(page.getByTestId("highlighted-text")).toBeVisible();
    // The page scrolls smoothly to the results; mid-scroll the sticky header covers the buttons, so wait for it to stop
    await expect.poll(() => page.evaluate(() => new Promise<boolean>((done) => {
      const y = window.scrollY;
      setTimeout(() => done(window.scrollY === y), 200);
    }))).toBe(true);
    await check("analysis");
  });
}
