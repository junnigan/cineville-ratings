# Cineville Ratings

在 [Cineville](https://cineville.nl) 电影页上显示评分、官方译名、简介和短评的浏览器插件(Chrome,Manifest V3)。

Shows ratings, localized titles, synopses and short reviews on cineville.nl.

## 功能

- 列表页、横幅和详情页显示 TMDB / IMDb / NeoDB / 豆瓣评分
- 官方译名:例如 Léon → 这个杀手不太冷
- Cineville 没有简介时自动补充;开启翻译时用目标语言的简介替换原简介
- 详情页短评,多个来源混排
- 设置面板就在 Cineville 页面右下角(⚙),也可以点工具栏图标打开

## 安装

1. `git clone https://github.com/junnigan/cineville-ratings.git`
2. 打开 `chrome://extensions`,开启"开发者模式"
3. 点"加载已解压的扩展程序",选择这个文件夹

## 数据来源和 API Key

| 来源 | 用途 | 需要 key |
|---|---|---|
| [TMDB](https://www.themoviedb.org/settings/api) | 匹配电影、多语言译名和简介、评分、评论 | 是(免费) |
| [NeoDB](https://neodb.social) | 评分、短评、华语译名 | 否 |
| [OMDb](https://www.omdbapi.com/apikey.aspx) | IMDb 评分 | 是(免费,每天 1,000 次) |
| 豆瓣 | 评分、简介、短评 | 否,但依赖浏览器里已登录的豆瓣 |

key 在页面右下角的设置面板里填写,只保存在你自己的浏览器里(`chrome.storage.sync`),不会写进代码。不填 key 时,插件仍可使用 NeoDB。

豆瓣没有公开 API。插件只是用你已登录的浏览器会话读取页面,没有登录或被拦截时会显示"–",随时可能失效,不保证可用。

## 隐私

打开电影页时,电影的片名、年份和导演会发送给 TMDB、NeoDB、OMDb(以及豆瓣、IMDb),用于查找评分。结果缓存在本地浏览器,不会发送给其他任何服务器,也不收集任何使用数据。

## 声明

This product uses the TMDB API but is not endorsed or certified by TMDB.
评分和评论版权归各自平台及用户所有。本项目与 Cineville、TMDB、IMDb、豆瓣、NeoDB 没有隶属关系。

## 许可证

MIT
