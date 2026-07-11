# Public Demo Manual QA Checklist

Use this checklist before sharing public review links.

> Current status: v0.2 is not deployed to GitHub Pages. Sections B-F are a future deployment checklist and must use a verified `<v0.2-public-url>`. A source-branch push does not make these URLs live.

## A. Original Demo

- Open `https://foxian-aaron.github.io/careband-agent-demo/#/institution`.
- Open `https://foxian-aaron.github.io/careband-agent-demo/#/elder/E001/profile`.
- Open `https://foxian-aaron.github.io/careband-agent-demo/#/medication/E001`.
- Verify the original demo still works and has not been overwritten by v0.2.

## B. Future v0.2 Static Preview

- Open `<v0.2-public-url>/#/institution` only after the base URL returns HTTP 200.
- Verify the banner says:
  `GitHub Pages 靜態預覽版：目前使用 mock fallback；完整 Express + SQLite + Agent 後端需本地或 Node hosting 啟動。`
- Verify a backend/mock indicator is visible.
- Verify `Demo v0.2 落地验证版` is visible.
- Verify `data_source` / `数据来源` is visible.
- Verify `data_quality` / `数据质量` is visible.
- Verify Agent source is visible as `Mock fallback`; a static Pages build cannot call QwenPaw or OpenAI.
- Verify the medical disclaimer is visible:
  `本結果僅為照護風險提示，不構成醫療診斷。`

## C. TEST001

- Open `<v0.2-public-url>/#/elder/TEST001`.
- Verify the main identity is `團隊 Apple Watch 測試資料`.
- Verify the page says `非真實長者`.
- Verify it says the purpose is validating wearable / Apple Health data import.
- Verify `data_source = Apple Health Export`.
- Verify `data_quality` and latest snapshot date are visible.
- Verify it does not show `陳伯` as the main identity.
- Verify there is a visible link to `查看陳伯照護閉環 Demo`.

## D. E001

- Open `<v0.2-public-url>/#/elder/E001/profile`.
- Verify the identity label says `陳伯 Demo 情境`.
- Verify the page describes a simulated elder care-loop scenario.
- Verify the script can explain `活動下降 + 頭暈 + SOS + 護工跟進`.

## E. DemoControlPanel

- Open `<v0.2-public-url>/#/demo-control`.
- Verify the target is visible: `目前照護流程操作對象：陳伯 E001`.
- Verify buttons say whether they affect E001 or TEST001.
- Verify the Apple Health sample button says it writes to TEST001.

## F. Unknown Route

- Open `<v0.2-public-url>/#/elder/UNKNOWN`.
- Verify the page says `資料未載入：找不到此長者資料。`
- Verify it does not show E001 / 陳伯 data.
- Verify navigation buttons exist:
  - `返回機構端`
  - `查看陳伯 E001 Demo`
  - `查看 TEST001 Apple Watch 測試資料`

## G. Backend Boundary

- Verify GitHub Pages does not claim the backend is online.
- Verify docs explain that GitHub Pages is static only.
- Verify local/backend deployment instructions exist in `docs/deployment.md`.
- Verify raw Apple Health XML/ZIP, `.env`, SQLite files, uploads, and `private_data/` are not committed.

## Optional Public Smoke Command

From the v0.2 repo:

```bash
CAREBAND_V02_PUBLIC_URL=https://example.invalid/careband-v0.2/ npm run check:public
```

Replace the placeholder with a verified deployment URL. Without the environment variable, the command checks only the original root demo.
