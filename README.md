# 貓家日子客用住宿試算與預約

這是一個提供客人自行估算貓咪住宿費用、填寫必要資料並帶入 LINE 官方帳號的單頁工具，可直接部署至 GitHub Pages，不需要安裝任何套件或後端。

## 客人使用流程

1. 選擇房型、貓咪數量、住宿日期與退宿時間。
2. 網頁即時計算原價、長住折扣、安親費與預估總額。
3. 點選「下一步・開始填寫預約」。
4. 填寫飼主、緊急聯絡人，以及每隻貓咪的飲食、健康與照護資料。
5. 點選「帶入 LINE，確認後送出」，網頁會開啟貓家日子 LINE 官方帳號並預先填入完整內容。

客人的表單內容只在瀏覽器中整理，不會儲存在 GitHub Pages；LINE 開啟後仍需由客人確認並按下送出。

## 已包含的計價規則

- 貓家小貓房：每晚 NT$850
- 探險家庭房：每晚 NT$1,300
- 貓家小貓房：最多入住 4 隻貓
- 探險家庭房：最多入住 6 隻貓
- 第 2 隻貓起：每隻每晚加收 NT$200
- 入住 7–13 晚：住宿費享 95 折
- 入住 14 晚以上：住宿費享 9 折
- 超過 15:00 退宿：加收當次單晚房價的 50%
- 15:00 準時或以前退宿：不加收安親費
- 住宿晚數以入住日與退宿日的日期差計算
- 長住折扣套用於住宿費；超時安親費不參與折扣

## 上傳到 GitHub Pages

1. 在 GitHub 建立一個新的 repository。
2. 將 `index.html` 與 `assets/days-with-cats-logo.png` 上傳到 repository。
3. 進入 repository 的 **Settings → Pages**。
4. 在 **Build and deployment** 選擇 **Deploy from a branch**。
5. Branch 選擇 `main`，資料夾選擇 `/ (root)`，再按 **Save**。
6. 等待 GitHub 完成部署，Pages 頁面會顯示可公開瀏覽的網址。

## 修改價格

用文字編輯器打開 `index.html`，搜尋以下設定即可調整：

```js
small: { name: "貓家小貓房", baseRate: 850, maxCats: 4 },
family: { name: "探險家庭房", baseRate: 1300, maxCats: 6 },
const EXTRA_CAT_RATE = 200;
const DAYCARE_RATE = 0.5;
const LONG_STAY_TIERS = [
  { minimumNights: 14, multiplier: 0.9 },
  { minimumNights: 7, multiplier: 0.95 },
];
```

價格調整後，重新把 `index.html` 上傳並覆蓋原檔案即可。
