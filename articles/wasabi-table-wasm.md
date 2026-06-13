---
title: "RustとWasmでExcel風テーブルコンポーネントを作ってnpmに公開するまで"
emoji: "🌊"
type: "tech"
topics: ["rust", "webassembly", "typescript", "canvas", "npm"]
published: false
---

# 作ったもの

**wasabi-table** という npm パッケージを作りました。

Rust + WebAssembly + Canvas で動く、Excel 風のテーブルコンポーネントです。SaaS の管理画面でよく出てくる「マスタデータをガリガリ編集する画面」を想定して作りました。

https://masanori0209.github.io/wasabi-table/examples/npm-package/index.html

![wasabi-tableのデモ画面](/images/01-full-dark.png)

![サンプルデータを読み込んだ状態](/images/02-table-close.png)

セルの選択・範囲選択・インライン編集・コピペ・Undo/Redo・フィルター・ソート・列リサイズあたりは一通り動きます。「スプレッドシート」ではなく「Excel っぽい操作感のテーブル」という立ち位置です（数式エンジンとかは作っていません）。

---

# なぜ作ったか

業務系の SaaS を作っていると、管理画面に「マスタデータの一覧 + 編集」画面が必要になることが多いです。

普通の `<table>` タグで作ると、行数が増えるにつれてパフォーマンスが落ちていきます。1000 行を超えたあたりからスクロールがカクついて、ユーザーから「重い」と言われる未来が見えます。

仮想スクロールで行を間引く方法もありますが、それだと DOM の更新コストはまだ残るし、Excel 的な「範囲選択してコピー」みたいな操作を実装しようとすると急に複雑になります。

そこで「Canvas で描いて Rust/Wasm でホットパスを処理すれば、大量行でも Excel 的な UX を実現できるんじゃないか」と思って作り始めました。

---

# 技術構成

こういうアーキテクチャになっています。

```
アプリ (React / Vue / plain HTML)
           ↓
TypeScript ラッパー (src-ts/ → dist/)
  ・WasabiTable クラス、undo/redo
  ・フィルター・ソート、RecordsDataSource
  ・DOM: スクロールバー、ツールチップ
           ↓ wasm-bindgen
Rust コア (src/ → pkg/*.wasm)
  ・Canvas 2D 描画
  ・ヒットテスト、スクロール計算
  ・セルデータ、選択、編集、クリップボード
```

簡単にいうと「描画と当たり判定は Rust、それ以外は TypeScript」という分担です。

## Canvas を選んだ理由

DOM テーブル (`<tr><td>`) は、行数に比例して DOM ノード数が増えます。ブラウザの再レイアウトが走るたびに重くなる。

Canvas なら、何行あっても描いているのは 1 枚の `<canvas>` 要素だけです。スクロールで見えている部分だけをバッチ描画すれば、表示行数に関係なく一定のパフォーマンスを保てます。

## Rust を選んだ理由

Canvas の描画ループ・ヒットテスト（クリック座標からセルを特定する処理）・大量データのバッチ処理は、毎フレーム・毎イベントで走るホットパスです。ここは GC の影響を受けやすい JavaScript よりも、メモリを自分でコントロールできる Rust の方が安定します。

逆に、フィルター・ソートのロジックや設定の JSON パースは TypeScript 側に置いています。こっちのほうがテストしやすいし、Rust をリビルドしなくてもオペレーターを追加できます。

---

# 作り始める前に決めたこと

最初に「何を作らないか」を決めました。

**スコープ外:**
- 数式エンジン (`=SUM` とか)
- ピボットテーブル・グラフ・セル結合
- リアルタイムコラボレーション
- SSR / Node.js での動作

これが大事でした。「Excel みたいなやつ」というワードは範囲が広すぎて、決めないと無限に機能追加したくなります。「管理画面でマスタを編集する UX」に絞ることで、実際に作り切れました。

---

# 実装でハマったところ

## WASM の初期化タイミング

`wasm-bindgen` でビルドすると、WASM バイナリの初期化が非同期になります。`WasabiTable.create(canvas)` を `await` しないと、まだ WASM がロードされていない状態でテーブルを操作しようとしてクラッシュします。

これを防ぐために、クラスのコンストラクタを `private` にして `static async create()` というファクトリメソッド経由でしか作れないようにしました。こうすると「`await` し忘れ」を型レベルで防げます。

```typescript
// こう書かせる (awaitが必須になる)
const table = await WasabiTable.create(canvas);

// これはできない
const table = new WasabiTable(canvas); // private
```

## インライン編集のオーバーレイ

Canvas 上でセルを編集するとき、`<canvas>` 要素は直接テキスト入力を受け付けません。なので編集中だけ `<input>` 要素を Canvas の上に重ねてオーバーレイ表示する方法を取っています。

厄介なのがポジションの計算。セルの座標は Rust 側が持っているので、入力欄をどこに置くかを Rust から計算させて、DOM のスタイルに反映するという連携が必要でした。スクロールしたり列をリサイズしたりすると当然ずれるので、都度同期が走ります。

## 100万行モードの仕組み

`dataSource.records` に 100 万行の配列を渡しても動くのは、全部を WASM に突っ込んでいるわけではないからです。

スクロール位置から「今画面に見えている行 ± バッファ」の範囲だけを WASM に送り込んでいます。スクロールのたびにビューポートを推定して、500 行単位でバッチ送信。WASM 内には常に 1000 行程度しか存在しません。

```typescript
// 見えている範囲 + バッファだけ送る
const { start, end } = estimateViewportRowRange();
wasmTable.set_row_batch(JSON.stringify({
  start_row: start,
  values: records.slice(start, end)
}));
```

![フィルター適用後のテーブル（エンジニアのみ表示）](/images/04-filtered.png)

## bundler ターゲットへの切り替え

最初は `wasm-pack build --target web` でビルドしていたのですが、これだと `.wasm` ファイルを `fetch()` でロードするコードが wasm-bindgen のグルーコードに埋め込まれます。

Vite のようなバンドラーで使う場合は `--target bundler` にしないとうまく動きません。また、バンドラーターゲットにすると `.wasm` はバンドラーが静的アセットとして処理してくれるので、CDN キャッシュも効きます。

これに気づくのが遅れて v1.0.4 で直しました。最初からドキュメントを読んでおけばよかった……

---

# npm への公開

`wasm-pack` でビルドすると `pkg/` ディレクトリに `.wasm` と JS グルーコードが生成されます。TypeScript ラッパーのビルド結果 `dist/` と合わせて、`package.json` の `files` フィールドに両方を列挙しておきます。

```json
"files": [
  "dist/",
  "pkg/wasabi_table.js",
  "pkg/wasabi_table_bg.wasm",
  ...
]
```

あとは `npm publish` するだけです。が、実際には `prepublishOnly` スクリプトでデバッグログを削除する処理を挟んでいます。開発中に `console.log` を大量に書いていたので……

```json
"prepublishOnly": "npm run build && npm run strip-debug-logs:dist"
```

## バンドルサイズ

| ファイル | サイズ (gzip 前) |
|---------|----------------|
| `.wasm` | 約 1.2 MB |
| JS ラッパー | 約 250 KB |

WASM ファイルは初回ロード後はブラウザキャッシュに乗るので、2 回目以降は気になりません。初回だけ「ちょっと重いな」と感じるサイズではあります。

---

# API の設計

使う側が「どこまでやりたいか」によって段階的に使えるように、3 段階の API を用意しています。

**Tier 1: とにかく動かす**

```typescript
const table = await WasabiTable.create(canvas);
table.setCellValue(0, 0, 'Hello');
table.render();
```

canvas 要素を渡すだけで動きます。設定は全部デフォルトです。

**Tier 2: 業務画面らしくする**

```typescript
const { table } = await createWasabiTableWithListeners(canvas, {
  row_count: 50,
  col_count: 10,
  headers: [
    { label: '名前', field_type: 'CharField', max_length: 50 },
    { label: 'メール', field_type: 'EmailField' },
  ]
}, {
  cellReferenceSelector: '#cellRef',
  formulaInputSelector: '#formula',
  statsElementSelector: '#stats',
});
```

列の型を指定するとバリデーションが効きます。メール形式じゃないセルに入力するとエラーのツールチップが出る、みたいな挙動です。

**Tier 3: 大量データ**

```typescript
const table = await WasabiTable.create(canvas, {
  dataSource: {
    records: millionRowArray,
    columns: columnDefs,
  }
});
```

`records` に配列を渡すだけで、前述のビューポート同期が自動で動きます。

---

# デモと GitHub Pages

`examples/` 以下に HTML でデモを書いて、GitHub Actions で GitHub Pages にデプロイしています。

Vite でビルドしてデプロイしているので、WASM ファイルが静的アセットとして正しいパスに配置されます。

![ベンチマーク画面](/images/06-benchmark.png)

ベンチマークページ (`benchmark.html`) では 100 行〜100 万行まで行数を切り替えて、実際にどれくらいのパフォーマンスが出るか計測できます。環境によって差が出るので、自分の環境で試してみてください。

https://masanori0209.github.io/wasabi-table/examples/npm-package/benchmark.html

---

# テスト構成

テストは 4 層に分けています。

| 対象 | ツール |
|------|--------|
| TypeScript の純粋ロジック (filter-sort 等) | Vitest |
| Rust のユーティリティ関数 | `cargo test` |
| WASM + ブラウザ | `wasm-pack test --headless --chrome` |
| ユーザー操作の再現 | Playwright E2E |

フィルター・ソートのロジックを TypeScript 側に置いたのは、ここを Vitest でユニットテストしやすくするためでもあります。WASM 越しにテストするより圧倒的に速い。

---

# やってみてどうだったか

Rust でブラウザ向けのものを作るのは、エラーが出たときのデバッグが独特です。WASM ランタイムのスタックトレースは最初は読みにくいのですが、`console_error_panic_hook` を使うとパニック時のメッセージがブラウザのコンソールに出るようになるので、かなり楽になりました。

```toml
# Cargo.toml
[dependencies]
console_error_panic_hook = "0.1"
```

```rust
// lib.rs
pub fn main() {
    console_error_panic_hook::set_once();
}
```

これ入れておくと「WASM でパニックしたけど何が起きたかわからない」という状況が減ります。

wasm-bindgen の型マッピングも慣れるまで大変でした。Rust の `Vec<String>` を JS に渡す方法とか、`JsValue` と `serde_json` のやり取りとか。最終的には複雑なデータは JSON 文字列でやり取りするようにして、型の齟齬を減らしました。

---

# まとめ

- Rust + Wasm + Canvas の組み合わせで、大量行でも Excel 風の UX が作れる
- 「何を作らないか」を最初に決めると完成しやすい
- フィルター・ソートみたいなロジックは TypeScript 側に置くとテストしやすい
- `wasm-pack` → `npm publish` の流れはシンプルで意外とハマらない
- デバッグは `console_error_panic_hook` を入れておくと救われる

npm パッケージはこちらです。

https://www.npmjs.com/package/wasabi-table

GitHub リポジトリ:

https://github.com/masanori0209/wasabi-table

フィードバックや Issue もお待ちしています。
