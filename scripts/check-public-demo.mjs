const urls = {
  root: "https://foxian-aaron.github.io/careband-agent-demo/",
  v02: process.env.CAREBAND_V02_PUBLIC_URL?.trim() || null,
};

const assertOk = async (url) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": "careband-public-smoke-check",
    },
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.text();
};

const assetUrlsFromHtml = (html, baseUrl) => {
  const urls = new Set();
  const pattern = /(?:src|href)=["']([^"']+\.(?:js|css))["']/g;
  let match = pattern.exec(html);
  while (match) {
    urls.add(new URL(match[1], baseUrl).toString());
    match = pattern.exec(html);
  }
  return [...urls];
};

const main = async () => {
  const rootHtml = await assertOk(urls.root);

  if (!rootHtml.includes("<!doctype html>") && !rootHtml.includes("<!DOCTYPE html>")) {
    throw new Error("Root demo did not return HTML.");
  }
  console.log(`Root HTML: ${urls.root}`);

  if (!urls.v02) {
    console.log("v0.2 public URL is not configured; source branch only.");
    return;
  }

  const v02Html = await assertOk(urls.v02);
  const v02Assets = assetUrlsFromHtml(v02Html, urls.v02);
  if (!v02Assets.length) {
    throw new Error("v0.2 HTML did not reference JS/CSS assets.");
  }

  for (const assetUrl of v02Assets) {
    await assertOk(assetUrl);
  }

  console.log("Public demo smoke check passed.");
  console.log(`v0.2 HTML: ${urls.v02}`);
  console.log(`v0.2 assets checked: ${v02Assets.length}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
