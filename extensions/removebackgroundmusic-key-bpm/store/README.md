# BPM & Key Finder：Chrome 应用商店上架填写指南

插件给 removebackgroundmusic.app 用。功能：在浏览器本地识别歌曲的调性、Camelot 编号和 BPM，可以批量分析（也能直接拖入文件夹）、导出 CSV，另带手动打拍测速（Tap tempo）。不调用任何 API、不需要任何浏览器权限、不收集数据。

## 提交前必须完成

1. **网站隐私政策先上线插件章节。** 网站项目里已经加好 "Our Chrome extension" 一节（`messages/en.json` 的 `legal.privacy.extension.*`，以及 `src/blocks/legal/legal-doc.tsx`），部署后在 https://removebackgroundmusic.app/privacy-policy 能看到才可以提交插件。否则隐私政策（写着上传服务器、用 GA）会和控制台里"不收集数据"的声明矛盾，可能被拒。
2. **用发布插件的同一个 Google 账号，在 Search Console 验证 removebackgroundmusic.app**，否则 Official URL 选不到我们的网站。
3. 打包：

```bash
pnpm build removebackgroundmusic-key-bpm
pnpm check removebackgroundmusic-key-bpm
pnpm smoke removebackgroundmusic-key-bpm   # 在真实 Chrome 里加载插件，跑一遍示例歌曲
pnpm zip removebackgroundmusic-key-bpm     # → release/removebackgroundmusic-key-bpm-<版本>.zip；构建比源码旧时会拒绝打包
```

以后每次更新：先改 `static/manifest.json` 里的 `version`，再按上面的顺序重新打包上传。

## 1. 账号（Account）

- **交易者声明**：选**非交易者（Non-trader）**（2026-11-25 决定）。
- 开发者显示名称：Remove Background Music；联系邮箱需要点验证链接。

## 2. Package（上传包）

上传 `release/removebackgroundmusic-key-bpm-1.0.0.zip`。

## 3. Store listing（商品详情）

名称和简短描述来自插件里的 `_locales`，商店会自动读取。每种语言要分别填写详细描述，并上传截图。

| 语言 | 详细描述（复制「Description」段落） | 截图 |
| --- | --- | --- |
| English（默认） | `listing/en.md` | `images/screenshot-1-results-en.png`、`images/screenshot-2-dark-en.png`、`images/screenshot-3-start-en.png` |
| Español | `listing/es.md` | `images/screenshot-1-results-es.png` |
| Português (Brasil) | `listing/pt_BR.md` | `images/screenshot-1-results-pt_BR.png` |
| Português (Portugal) | `listing/pt_PT.md` | `images/screenshot-1-results-pt_PT.png` |
| Français | `listing/fr.md` | `images/screenshot-1-results-fr.png` |
| Deutsch | `listing/de.md` | `images/screenshot-1-results-de.png` |
| Русский | `listing/ru.md` | `images/screenshot-1-results-ru.png` |
| 日本語 | `listing/ja.md` | `images/screenshot-1-results-ja.png` |
| 한국어 | `listing/ko.md` | `images/screenshot-1-results-ko.png` |

其他语言的截图位置也可以再加上英文的第 2、3 张。

- **分类（Category）**：选控制台里最接近"工具"的一项（推荐 Tools）。以控制台下拉框实际给出的选项为准。
- **语言（Language）**：English。
- **商店图标（Store icon，128×128）**：要在 Graphic assets 里**单独上传** `static/icons/icon-128.png`（图案 96×96，四周各留 16px 透明边，符合官方要求）。
- **小宣传图（Small promo tile，440×280）**：`images/promo-small-440x280.png`
- **大宣传图（Marquee，1400×560，选填）**：`images/promo-marquee-1400x560.png`
- **YouTube 视频**：不填。
- **Mature content**：关闭。

### 外链（Additional fields）

| 字段 | 填写 |
| --- | --- |
| Official URL | `https://removebackgroundmusic.app`（需要先完成 Search Console 验证） |
| Homepage URL | `https://removebackgroundmusic.app/key-bpm-finder` |
| Support URL | `https://removebackgroundmusic.app/contact` |

上架后，在网站的 `/key-bpm-finder` 页面加一段插件介绍和商店链接（官方要求 Homepage 页面介绍这个插件，也能让商店和网站形成互链）。这需要改网站，等拿到商店链接后再做。

## 4. Privacy practices（隐私惯例）

**Single purpose description**（单一用途说明，英文填写）：

> Finds the musical key, Camelot code and tempo (BPM) of audio and video files the user chooses, by analyzing them locally in the browser, and includes a tap-tempo counter.

**Permission justification**：插件没有申请任何权限（manifest 里没有 `permissions`、`host_permissions`，也没有 content script），所以这一项没有要填的内容。如果控制台仍然要求填写，就写：

> The extension requests no permissions. The toolbar button only opens the extension's own page in a tab.

**Are you using remote code?** 选 **No, I am not using remote code**。所有 JavaScript 都打包在插件里，解码库 mediabunny 只打包了解码要用的部分，也在包内；插件不从网络加载或执行任何代码。

**Data usage**：所有数据类别都**不勾选**。下面三条合规声明都勾选：

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**：`https://removebackgroundmusic.app/privacy-policy`（插件章节的锚点是 `#chrome-extension`）。

## 5. Distribution（发布范围）

- 免费，公开（Public）。
- 地区：所有地区。

## 说明

- **名称**：每种语言的名称都只用一次核心词，不在名称里放 "Camelot"（它可能是别家的商标）。描述末尾有一句"与 Camelot、Open Key 的所有者无关联"。
- **链接追踪**：插件里指向网站的链接都带有 `utm_source=chrome_extension&utm_medium=referral&utm_campaign=key_bpm_finder` 和 `utm_content`，方便在 GA4 里看到从插件来的访问。"更多工具"区块注明了部分工具需要付费积分。
- **许可证**：包内的 `licenses/` 里有 mediabunny 的 MPL-2.0 全文，以及 NOTICE（写明源码地址和示例音频的来源）。示例音频是给网站首页做的 AI 生成曲（minimax/music-3），首页也在用；它的商用条款请自行确认。
- **截图**：截图里的演示歌曲是脚本现场合成的（已知调性和速度），结果都是插件自己真实分析出来的。重新生成：先运行 `pnpm preview removebackgroundmusic-key-bpm`，再运行 `pnpm shoot removebackgroundmusic-key-bpm`。
- **多语言**：界面文案的源头是 `locales.mjs`。改完运行 `pnpm locales removebackgroundmusic-key-bpm` 重新生成 `_locales`，不要直接改 `messages.json`。
- **识别代码**：都复制自网站项目，见 `src/vendor/SOURCE.md`。
