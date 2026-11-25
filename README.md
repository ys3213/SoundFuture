# 讓聲

> 話音停了，你還聽得見我嗎？

《讓聲》是一個八拍的共用樂譜。畫一段旋律，拖動交接線，把一部分拍子交給系統或另一個人。

**[開啟作品](https://ys3213.github.io/SoundFuture/)**

## 試奏

1. 點「啟用音訊」，再點「開始合奏」。
2. 把交接線從主句 5 拍拖到 3 拍，聽回應多兩拍後的變化。
3. 切換「共奏」，選擇畫回應，或開啟麥克風、鏡頭參與。按 Esc 停止。

翻閱[進階測試計畫](project/TEST-PLAN.md)，或在 [Issues](https://github.com/ys3213/SoundFuture/issues) 追蹤實測。

## 本機開啟

直接用 Chrome 開啟 `docs/index.html`，可以離線畫譜及單人接聲。若要在本機使用感測裝置，開啟本機網頁伺服器：

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory docs
```

打開 [127.0.0.1:8000](http://127.0.0.1:8000/)。哼唱與鏡頭使用瀏覽器授權，波形和畫面由瀏覽器在裝置上處理。

## 檔案與維護

| 位置 | 內容 |
| --- | --- |
| `docs/` | 作品介面、八拍規則、聲音合成、音高與鏡頭辨識。GitHub Pages 從這裡發布。 |
| `tests/` | Node 規則測試、Chrome 操作與媒體模擬測試。 |
| `project/` | 進階測試的順序、操作與驗收標準。 |

`node --test tests/rules.cjs` 可直接測試規則。已安裝 Playwright 與 Chrome 時，可執行 `node tests/chrome.cjs` 驗證操作與音訊。修改作品後重跑相關測試，再推送 `main`。發布後從作品網址驗證當前畫面與音訊。
