# Third Party Notices

Parts of the X Articles editor bridge in `extension/main-world.js` are adapted from the xPoster project:

- Repository: https://github.com/nevertoday/xposter
- License: MIT

The adapted pattern finds the X Articles Draft.js editor state and media upload handler from the page's React tree, then uses X's own image upload flow instead of treating HTML `<img>` tags as uploaded media.
