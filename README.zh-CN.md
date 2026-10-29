# Cineville Ratings

[English](README.md) · **中文**

在 [cineville.nl](https://cineville.nl) 电影页上显示评分、官方译名、简介和短评的 Chrome 插件(Manifest V3)。

## 功能

- **评分**:TMDB、IMDb、NeoDB、豆瓣,显示在电影列表、横幅和详情页
- **官方译名**:例如 *Léon* → *这个杀手不太冷*,目标语言可选
- **简介**:Cineville 没有简介时自动补充;开启翻译后,用目标语言的简介替换原简介
- **短评**:详情页混排豆瓣、NeoDB、TMDB 的短评,版式接近豆瓣(长评默认折叠,可展开)
- **短评翻译**:外语短评可用 Chrome 内置的本地翻译功能翻译(豆瓣短评拿不到时自动翻译)
- **适配手机**:大号触控按钮、底部弹出式设置面板、点按显示提示(代替悬停),可在安卓版 Firefox 上使用
- **页面内设置**:点 Cineville 页面右下角的 ⚙ 按钮(或工具栏图标)。界面语言跟随浏览器,也可以在设置里手动切换

## 安装

1. `git clone https://github.com/junnigan/cineville-ratings.git`
2. 打开 `chrome://extensions`,开启"开发者模式"
3. 点"加载已解压的扩展程序",选择克隆下来的文件夹

### Firefox(电脑版和安卓版)

运行 `./scripts/package-firefox.sh`,然后在 Firefox 打开 `about:debugging#/runtime/this-firefox`,点"临时载入附加组件",选 `dist/firefox-build/manifest.json`。(正式签名版会发布到 addons.mozilla.org。)安装后请确认扩展被允许访问它列出的网站。安卓版 Firefox 等正式上架后,可以直接在附加组件菜单里安装。
Firefox 没有内置翻译功能,所以那里不会显示短评的"翻译"链接。

短评翻译需要 Chrome 138 或更新版本。某个语言对第一次翻译时,会下载一个很小的语言包。

## 数据来源和 API Key

| 来源 | 用途 | 需要 key |
|---|---|---|
| [TMDB](https://www.themoviedb.org/settings/api) | 匹配电影、多语言译名和简介、评分、评论 | 是(免费) |
| [NeoDB](https://neodb.social) | 评分、短评、华语译名 | 否 |
| [OMDb](https://www.omdbapi.com/apikey.aspx) | IMDb 评分 | 是(免费,每天 1,000 次) |
| 豆瓣 | 评分、简介、短评 | 否,但需要在同一个浏览器里登录豆瓣 |

在 Cineville 页面打开 ⚙ 面板,点"免费申请 Key"按钮即可跳转到官方申请页。key 只保存在你自己的浏览器里(`chrome.storage.sync`),不会出现在代码仓库中。不填 key 时,插件仍可使用 NeoDB。

豆瓣没有公开 API。插件只是用你已登录的浏览器会话读取页面,被拦截时豆瓣标签会显示"–",随时可能失效。

IMDb 会拦截直接抓取,所以 IMDb 评分需要 OMDb key。OMDb 不提供评论。

## 隐私

打开电影页时,电影的片名、年份、导演和演员会发送给 TMDB、NeoDB、OMDb(以及豆瓣、IMDb)用于查找评分,结果缓存在本地浏览器。不会发送给其他任何服务器,也不收集使用数据。短评翻译在 Chrome 本机完成。

## 非商业使用

本项目免费开源。TMDB 的 API 条款不允许未经单独协议的商业使用,所以请不要加入付费版、广告或联盟链接,也不要让多个用户共用同一个 API key。

## 隐私政策

见 [PRIVACY.md](PRIVACY.md)。

## 声明

This product uses the TMDB API but is not endorsed or certified by TMDB.
评分和评论的版权归各自平台和作者所有。本项目与 Cineville、TMDB、IMDb、豆瓣、NeoDB 没有隶属关系。

## 许可证

[MIT](LICENSE)
