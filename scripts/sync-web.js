// index.html（Web版の唯一のソース）と、ローカルのBGM音源を www/ にコピーする。
// www/ はCapacitorのビルド用フォルダで、完全にこのスクリプトの出力なので
// リポジトリには含めない（.gitignore参照）。ビルドツールを導入せず、単一HTML
// ファイル構成のまま Capacitor 用の webDir を用意するための最小限のスクリプト。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const wwwDir = path.join(root, 'www');
const bgmSrc = path.join(root, 'assets', 'bgm');
const bgmDest = path.join(wwwDir, 'assets', 'bgm');

fs.mkdirSync(wwwDir, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(wwwDir, 'index.html'));
console.log('copied index.html -> www/index.html');

// PWA関連ファイル（manifest・Service Worker）。ネイティブアプリ側では
// index.html内のガードにより登録されないが、www/ をリポジトリの内容の
// 忠実なミラーにしておくため一応コピーしておく。
for (const file of ['manifest.webmanifest', 'service-worker.js']) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(wwwDir, file));
    console.log('copied ' + file);
  }
}
fs.mkdirSync(path.join(wwwDir, 'assets'), { recursive: true });
for (const file of ['pwa-icon-192.png', 'pwa-icon-512.png']) {
  const src = path.join(root, 'assets', file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(wwwDir, 'assets', file));
    console.log('copied assets/' + file);
  }
}

if (fs.existsSync(bgmSrc)) {
  fs.mkdirSync(bgmDest, { recursive: true });
  for (const file of fs.readdirSync(bgmSrc)) {
    if (file.toLowerCase().endsWith('.mp3')) {
      fs.copyFileSync(path.join(bgmSrc, file), path.join(bgmDest, file));
      console.log('copied assets/bgm/' + file);
    }
  }
} else {
  console.log('assets/bgm/ が見つかりません。BGMなしで続行します（アプリ本体は問題なく動作します）。');
}
