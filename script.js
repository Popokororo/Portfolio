
// ========================================
// 保存キー
// ========================================

const KEY_DRAFT = "popocoro_portfolio_draft_v2";
const KEY_PUB = "popocoro_portfolio_published_v2";


// ========================================
// 初期データ
// カテゴリは最初から登録しない
// ========================================

const defaults = {
    name: "ポポコロ",
    activity: "イラスト制作",
    intro: "イラストを制作しています。",

    heroImage: "",
    avatar: "",

    socialLinks: [],

    categories: [],
    works: [],

    bg: "#171717",
    text: "#e9eaf0",
    accent: "#293c70",

    font: "gothic",
    weight: "400",
    italic: false,

    headline: "Illustration",
    eyebrow: "SELECTED COLLECTION",
    filterAll: "ALL",
    modalClose: "閉じる"
};


// ========================================
// 共通関数
// ========================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entities[character];
    });
}


function cloneData(data) {
    return JSON.parse(JSON.stringify(data));
}


// IndexedDBを利用して下書き・公開データを保存します。
// 画像は元ファイルを変換せずデータURLのまま保存するため、画質は変わりません。
const IDB_NAME = "popocoro_portfolio_db";
const IDB_STORE = "portfolio_data";
let idbDatabase = null;
let idbReady = false;
let modalImages = [];
let modalImageIndex = 0;
let editingWorkImages = [];

function openPortfolioDB() {
    return new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) {
            reject(new Error("このブラウザはIndexedDBに対応していません。"));
            return;
        }
        const request = indexedDB.open(IDB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE, { keyPath: "key" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDBを開けませんでした。"));
    });
}

function idbGet(key) {
    return new Promise((resolve, reject) => {
        const request = idbDatabase.transaction(IDB_STORE, "readonly")
            .objectStore(IDB_STORE).get(key);
        request.onsuccess = () => resolve(request.result ? request.result.value : null);
        request.onerror = () => reject(request.error);
    });
}

function idbSet(key, data) {
    return new Promise((resolve, reject) => {
        const transaction = idbDatabase.transaction(IDB_STORE, "readwrite");
        transaction.objectStore(IDB_STORE).put({ key, value: cloneData(data) });
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDBへの保存に失敗しました。"));
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDBへの保存が中断されました。"));
    });
}

async function initializeIndexedDB() {
    idbDatabase = await openPortfolioDB();
    idbReady = true;
    const [savedDraft, savedPublished] = await Promise.all([
        idbGet(KEY_DRAFT), idbGet(KEY_PUB)
    ]);
    return { savedDraft, savedPublished };
}

function readStorage(key, fallback) {
    try {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : cloneData(fallback);
    } catch (error) {
        console.warn("従来の保存データを読み込めませんでした。", error);
        return cloneData(fallback);
    }
}

function persist(key, data) {
    if (!idbReady || !idbDatabase) {
        // 起動処理中のみ旧ストレージに退避し、初期データを失わないようにする。
        try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) {}
        return true;
    }
    idbSet(key, data).catch(error => {
        console.error("IndexedDBにデータを保存できませんでした。", error);
        alert("データをIndexedDBに保存できませんでした。\nブラウザの空き容量やサイトの保存設定を確認してください。\n念のため、登録内容をZIPに書き出してバックアップしてください。");
    });
    return true;
}


function cleanText(value) {
    return String(value ?? "").trim();
}


// ========================================
// IDを作成する
// ========================================

function createId() {
    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {
        return crypto.randomUUID();
    }

    return (
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 10)
    );
}


// ========================================
// VS Code側のデータファイルを取得する
// ========================================

// portfolio-data.js が設定したデータを取得する。
// ファイルが空、または初期状態なら defaults を使う。

function getFileData() {
    const fileData = window.PORTFOLIO_EXPORTED_DATA;

    if (
        fileData &&
        typeof fileData === "object" &&
        !Array.isArray(fileData)
    ) {
        return fileData;
    }

    return defaults;
}


// ========================================
// データ形式を整える
// ========================================

function upgradeData(data) {
    const result = {
        ...cloneData(defaults),
        ...(data && typeof data === "object" ? data : {})
    };

    if (!Array.isArray(result.categories)) {
        result.categories = [];
    }

    if (!Array.isArray(result.works)) {
        result.works = [];
    }

    if (!Array.isArray(result.socialLinks)) {
        result.socialLinks = [];
    }

    // カテゴリ名の前後の空白を除き、重複を取り除く
    result.categories = [
        ...new Set(
            result.categories
                .filter(category => typeof category === "string")
                .map(category => category.trim())
                .filter(Boolean)
        )
    ];

    // 作品データの不足項目を補う
    result.works = result.works
        .filter(work => work && typeof work === "object")
        .map((work, index) => {
            const images = Array.isArray(work.images)
                ? work.images.filter(image => typeof image === "string" && image)
                : (work.image ? [work.image] : []);

            return {
                id: work.id || createId(),
                title: work.title || "",
                // 複数画像データを保持する。旧形式の image だけの作品も読み込める。
                images,
                image: work.image || images[0] || "",
                description: work.description || "",
                date: typeof work.date === "string" ? work.date : "",
                categories: Array.isArray(work.categories)
                    ? [...new Set(work.categories.filter(category => typeof category === "string").map(category => category.trim()).filter(Boolean))]
                    : (work.category ? [work.category] : []),
                category: work.category || (Array.isArray(work.categories) ? work.categories[0] || "" : ""),
                order: Number.isFinite(Number(work.order))
                    ? Number(work.order)
                    : index
            };
        });

    // SNSリンクの不足項目を補う
    result.socialLinks = result.socialLinks
        .filter(link => link && typeof link === "object")
        .map(link => {
            return {
                id: link.id || createId(),
                label: link.label || "",
                url: link.url || ""
            };
        });

    // 古い初期カテゴリ「自主制作」を削除する
    result.categories = result.categories.filter(category => {
        return category !== "自主制作";
    });

    // 古い初期カテゴリを使用していた作品は未分類にする
    result.works.forEach(work => {
        work.categories = (work.categories || []).filter(category => category !== "自主制作");
        if (work.category === "自主制作") work.category = "";
        if (!work.categories.length && work.category) work.categories = [work.category];
    });

    // 登録されていないカテゴリを使用する作品は未分類にする
    result.works.forEach(work => {
        work.categories = (work.categories || [])
            .filter(category => result.categories.includes(category));
        if (!work.categories.length && work.category && result.categories.includes(work.category)) {
            work.categories = [work.category];
        }
        work.category = work.categories[0] || "";
    });

    return result;
}


// ========================================
// 初期データを読み込む
// ========================================

// VS Codeのデータファイルを初期値として使用する。
// ブラウザに保存済みのデータがある場合はそちらを優先する。

const fileData = getFileData();

let draft = upgradeData(
    readStorage(KEY_DRAFT, fileData)
);

const isPublicPage = document.body.dataset.role === "public";

// 公開ページではGitHubに配置された portfolio-data.js を必ず使用する。
// 管理ページではブラウザ内の編集・公開データを読み込む。
let published = upgradeData(
    isPublicPage ? fileData : readStorage(KEY_PUB, fileData)
);


// 管理ページのデータは、起動時にIndexedDBへ読み込み・保存します。


// ========================================
// 画面の状態
// ========================================

let currentPanel = "profile";
let currentFilter = "ALL";
let previewMode = false;
let editingWorkId = null;


// ========================================
// HTML要素
// ========================================

const publicView = document.getElementById("publicView");
const editView = document.getElementById("editView");

const publicTab = document.getElementById("publicTab");
const editTab = document.getElementById("editTab");

const editorContent = document.getElementById("editorContent");
const editorTitle = document.getElementById("editorTitle");
const editorStatus = document.getElementById("editorStatus");

const publishButton = document.getElementById("publishButton");
const previewButton = document.getElementById("previewButton");
const exportButton = document.getElementById("exportButton");
const resetButton = document.getElementById("resetButton");

const modalRoot = document.getElementById("modalRoot");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalClose = document.getElementById("modalClose");


// ========================================
// データの保存
// ========================================

function saveDraft(message = "下書きを保存しました。") {
    const success = persist(KEY_DRAFT, draft);

    if (success) {
        editorStatus.textContent = message;
    }

    return success;
}


// ========================================
// データを書き出す
// ========================================

// 現在の編集内容を反映した4ファイルをZIPにまとめてダウンロードする。
// ZIPは外部ライブラリを使わず、ブラウザ内で生成する。

function makeCrcTable() {
    const table = new Uint32Array(256);

    for (let n = 0; n < 256; n++) {
        let c = n;

        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }

        table[n] = c >>> 0;
    }

    return table;
}

const ZIP_CRC_TABLE = makeCrcTable();

function crc32(bytes) {
    let crc = 0xFFFFFFFF;

    for (let i = 0; i < bytes.length; i++) {
        crc = ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;

    const write16 = (view, offset, value) => view.setUint16(offset, value, true);
    const write32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);

    files.forEach(file => {
        const nameBytes = encoder.encode(file.name);
        const dataBytes = file.content instanceof Uint8Array
            ? file.content
            : encoder.encode(file.content);
        const checksum = crc32(dataBytes);

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const localView = new DataView(localHeader.buffer);
        write32(localView, 0, 0x04034B50);
        write16(localView, 4, 20);
        write16(localView, 6, 0x0800); // UTF-8ファイル名
        write16(localView, 8, 0); // 圧縮なし
        write16(localView, 10, 0);
        write16(localView, 12, 0);
        write32(localView, 14, checksum);
        write32(localView, 18, dataBytes.length);
        write32(localView, 22, dataBytes.length);
        write16(localView, 26, nameBytes.length);
        write16(localView, 28, 0);
        localHeader.set(nameBytes, 30);

        localParts.push(localHeader, dataBytes);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(centralHeader.buffer);
        write32(centralView, 0, 0x02014B50);
        write16(centralView, 4, 20);
        write16(centralView, 6, 20);
        write16(centralView, 8, 0x0800);
        write16(centralView, 10, 0);
        write16(centralView, 12, 0);
        write16(centralView, 14, 0);
        write32(centralView, 16, checksum);
        write32(centralView, 20, dataBytes.length);
        write32(centralView, 24, dataBytes.length);
        write16(centralView, 28, nameBytes.length);
        write16(centralView, 30, 0);
        write16(centralView, 32, 0);
        write16(centralView, 34, 0);
        write16(centralView, 36, 0);
        write32(centralView, 38, 0);
        write32(centralView, 42, localOffset);
        centralHeader.set(nameBytes, 46);
        centralParts.push(centralHeader);

        localOffset += localHeader.length + dataBytes.length;
    });

    const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);
    write32(endView, 0, 0x06054B50);
    write16(endView, 4, 0);
    write16(endView, 6, 0);
    write16(endView, 8, files.length);
    write16(endView, 10, files.length);
    write32(endView, 12, centralSize);
    write32(endView, 16, localOffset);
    write16(endView, 20, 0);

    return new Blob([...localParts, ...centralParts, endRecord], {
        type: "application/zip"
    });
}

async function exportPortfolioData() {
    if (!persist(KEY_DRAFT, draft)) {
        editorStatus.textContent =
            "保存に失敗したため、書き出しを中止しました。";
        return;
    }

    const originalLabel = exportButton.textContent;
    exportButton.disabled = true;
    exportButton.textContent = "書き出し中…";

    try {
        // 現在使用しているHTML・CSS・JavaScriptを読み込む。
        // Live ServerなどHTTP経由で開いている必要があります。
        const fileNames = ["index.html", "admin.html", "style.css", "script.js"];
        const sourceFiles = await Promise.all(fileNames.map(async name => {
            const response = await fetch(new URL(name, window.location.href), {
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error(`${name} を読み込めませんでした。`);
            }

            return {
                name,
                content: await response.text()
            };
        }));

        // 画像本体はPNG等の独立ファイルとしてZIPへ格納し、
        // portfolio-data.jsには相対パスだけを記録する。
        // data URLはfetchでBlob化するため、再圧縮・リサイズは行わない。
        const exportData = cloneData(draft);
        const imageFiles = [];
        let imageCount = 0;

        async function exportImage(value, relativePath) {
            if (typeof value !== "string" || !value) return value;

            let blob;
            if (value.startsWith("data:image/")) {
                const response = await fetch(value);
                blob = await response.blob();
            } else {
                // すでに相対パスになっている画像も、ZIPへ取り込んで
                // 単体で公開できるようにする。
                const response = await fetch(new URL(value, window.location.href));
                if (!response.ok) {
                    throw new Error(`画像を読み込めませんでした: ${value}`);
                }
                blob = await response.blob();
            }

            if (!blob.type.startsWith("image/")) {
                throw new Error(`画像ファイルとして読み込めませんでした: ${relativePath}`);
            }

            const extensionByType = {
                "image/png": "png",
                "image/jpeg": "jpg",
                "image/webp": "webp",
                "image/gif": "gif",
                "image/svg+xml": "svg",
                "image/avif": "avif"
            };
            const extension = extensionByType[blob.type] || "png";
            const filePath = `${relativePath}.${extension}`;
            imageFiles.push({
                name: filePath,
                content: new Uint8Array(await blob.arrayBuffer())
            });
            imageCount += 1;
            return filePath;
        }

        if (exportData.heroImage) {
            exportData.heroImage = await exportImage(
                exportData.heroImage,
                "images/main-image"
            );
        }

        if (exportData.avatar) {
            exportData.avatar = await exportImage(
                exportData.avatar,
                "images/profile-image"
            );
        }

        if (Array.isArray(exportData.works)) {
            for (let workIndex = 0; workIndex < exportData.works.length; workIndex += 1) {
                const work = exportData.works[workIndex];
                if (!work || typeof work !== "object") continue;

                const images = Array.isArray(work.images)
                    ? work.images
                    : (work.image ? [work.image] : []);

                const exportedImages = [];
                for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
                    const value = images[imageIndex];
                    if (!value) continue;
                    const workNumber = String(workIndex + 1).padStart(3, "0");
                    const imageNumber = String(imageIndex + 1).padStart(2, "0");
                    exportedImages.push(await exportImage(
                        value,
                        `images/works/work-${workNumber}-${imageNumber}`
                    ));
                }

                work.images = exportedImages;
                delete work.image;
            }
        }

        const dataFileContent =
            "// ========================================\n" +
            "// ポートフォリオのデータ（編集画面から自動生成）\n" +
            "// 画像本体は images フォルダに保存されています。\n" +
            "// ========================================\n\n" +
            "window.PORTFOLIO_EXPORTED_DATA = " +
            JSON.stringify(exportData, null, 4) +
            ";\n";

        const zipFiles = [
            ...sourceFiles,
            { name: "portfolio-data.js", content: dataFileContent },
            ...imageFiles
        ];

        const zipBlob = writeZip(zipFiles);
        const downloadUrl = URL.createObjectURL(zipBlob);
        const downloadLink = document.createElement("a");
        downloadLink.href = downloadUrl;
        downloadLink.download = "popocoro-portfolio.zip";
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

        editorStatus.textContent =
            `ZIPを書き出しました（画像${imageCount}点をimagesフォルダへ分離しました）。`;
    } catch (error) {
        console.error("ZIPを書き出せませんでした。", error);
        editorStatus.textContent =
            "ZIPを書き出せませんでした。画像ファイルまたはLive Serverの状態を確認してください。";
        alert(
            "ZIPを書き出せませんでした。\n" +
            "VS CodeのLive Serverでサイトを開いているか、画像ファイルが読み込めるか確認してください。\n\n" +
            error.message
        );
    } finally {
        exportButton.disabled = false;
        exportButton.textContent = originalLabel;
    }
}


// ========================================
// 書き出しボタン
// ========================================

exportButton.addEventListener("click", exportPortfolioData);


// ========================================
// 表示するデータを取得する
// ========================================

function getVisibleData() {
    if (previewMode) {
        return draft;
    }

    return published;
}


// ========================================
// 公開画面を表示する
// ========================================

function renderPublic() {
    const data = getVisibleData();

    // デザイン設定
    document.documentElement.style.setProperty(
        "--background",
        data.bg || defaults.bg
    );

    document.documentElement.style.setProperty(
        "--text",
        data.text || defaults.text
    );

    document.documentElement.style.setProperty(
        "--accent",
        data.accent || defaults.accent
    );

    document.body.style.fontFamily =
        data.font === "serif"
            ? '"Yu Mincho", "Hiragino Mincho ProN", serif'
            : '"Yu Gothic", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif';

    document.body.style.fontWeight = data.weight || "400";

    document.body.style.fontStyle =
        data.italic ? "italic" : "normal";


    // メイン画像
    const heroImage = document.getElementById("heroImage");
    const heroPlaceholder = document.getElementById("heroPlaceholder");

    if (data.heroImage) {
        heroImage.src = data.heroImage;
        heroImage.classList.remove("hidden");
        heroPlaceholder.classList.add("hidden");
    } else {
        heroImage.removeAttribute("src");
        heroImage.classList.add("hidden");
        heroPlaceholder.classList.remove("hidden");
    }


    // プロフィール画像
    const avatar = document.getElementById("profileAvatar");
    const avatarPlaceholder = document.getElementById("avatarPlaceholder");

    if (data.avatar) {
        avatar.src = data.avatar;
        avatar.classList.remove("hidden");
        avatarPlaceholder.classList.add("hidden");
    } else {
        avatar.removeAttribute("src");
        avatar.classList.add("hidden");
        avatarPlaceholder.classList.remove("hidden");
    }


    // プロフィール情報
    document.getElementById("profileName").textContent =
        data.name || "";

    document.getElementById("profileActivity").textContent =
        data.activity || "";

    document.getElementById("profileIntro").textContent =
        data.intro || "";


    // SNS・Webサイトのリンク
    const socialLinks = document.getElementById("socialLinks");

    socialLinks.innerHTML = "";

    data.socialLinks.forEach(link => {
        const label = cleanText(link.label);
        const url = cleanText(link.url);

        if (!label || !isValidHttpUrl(url)) {
            return;
        }

        const anchor = document.createElement("a");

        anchor.className = "social-link";
        anchor.textContent = label;
        anchor.href = url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";

        socialLinks.appendChild(anchor);
    });


    // 作品一覧の見出し
    document.getElementById("collectionHeadline").textContent =
        String(data.headline || "").replace(/[✧✦☆★]/g, "").trim();

    document.getElementById("collectionEyebrow").textContent =
        data.eyebrow || "";

    document.getElementById("footerText").textContent =
        "© " + (data.name || "ポポコロ");


    // カテゴリフィルターと作品を描画する
    renderCategoryFilters(data);
    renderWorks(data);
}


// ========================================
// URLの妥当性を確認する
// ========================================

function isValidHttpUrl(value) {
    try {
        const url = new URL(value);

        return (
            url.protocol === "https:" ||
            url.protocol === "http:"
        );
    } catch (error) {
        return false;
    }
}


// ========================================
// カテゴリフィルターを表示する
// ========================================

function renderCategoryFilters(data) {
    const container = document.getElementById("categoryFilters");

    container.innerHTML = "";

    const categories = ["ALL", ...data.categories];

    if (
        currentFilter !== "ALL" &&
        !data.categories.includes(currentFilter)
    ) {
        currentFilter = "ALL";
    }

    categories.forEach(category => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "filter-button";

        button.textContent =
            category === "ALL"
                ? (data.filterAll || "ALL")
                : category;

        if (currentFilter === category) {
            button.classList.add("active");
        }

        button.addEventListener("click", () => {
            currentFilter = category;

            renderCategoryFilters(data);
            renderWorks(data);
        });

        container.appendChild(button);
    });
}


// ========================================
// 作品の日付を表示用に整える
// ========================================

function formatWorkDate(value) {
    if (!value) return "";

    // 日付文字列をローカルタイムの Date として扱い、曜日を付けて表示する
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

    // 年・月・日を数値として組み立てることで、タイムゾーンによる曜日ずれを防ぐ
    return `${year}年${month}月${day}日（${weekdays[date.getDay()]}）`;
}

function updateWorkDateWeekday() {
    const dateInput = document.getElementById("workDate");
    const weekdayPreview = document.getElementById("workDateWeekday");

    if (!dateInput || !weekdayPreview) return;

    // 日付入力欄の直下に、選択した日付を曜日込みで表示する
    weekdayPreview.textContent = dateInput.value
        ? formatWorkDate(dateInput.value)
        : "";
}


// ========================================
// 作品一覧を表示する
// ========================================

function renderWorks(data) {
    const grid = document.getElementById("worksGrid");
    const emptyMessage = document.getElementById("emptyWorksMessage");

    grid.innerHTML = "";

    // 公開画面では新しく登録した作品を先頭（左側）に表示する。
    // 管理画面の並べ替えで設定した order はそのまま尊重し、
    // order が同じ場合は元の配列順を維持する。
    const visibleWorks = data.works
        .map((work, originalIndex) => ({ work, originalIndex }))
        .filter(({ work }) => {
            if (currentFilter === "ALL") {
                return true;
            }

            const workCategories = Array.isArray(work.categories)
                ? work.categories
                : (work.category ? [work.category] : []);
            return workCategories.includes(currentFilter);
        })
        .sort((a, b) => {
            const orderDifference = Number(b.work.order ?? b.originalIndex)
                - Number(a.work.order ?? a.originalIndex);
            return orderDifference || a.originalIndex - b.originalIndex;
        })
        .map(({ work }) => work);

    if (visibleWorks.length === 0) {
        emptyMessage.classList.remove("hidden");

        emptyMessage.textContent =
            data.works.length === 0
                ? "作品はまだ登録されていません。"
                : "このカテゴリに作品はありません。";
    } else {
        emptyMessage.classList.add("hidden");
    }

    visibleWorks.forEach(work => {
        const card = document.createElement("article");

        card.className = "work-card";
        card.tabIndex = 0;
        card.setAttribute("role", "button");

        card.setAttribute(
            "aria-label",
            (work.title || "作品") + "を拡大表示"
        );

        const imageWrap = document.createElement("div");
        imageWrap.className = "work-image-wrap";

        const image = document.createElement("img");
        image.className = "work-image";
        image.src = getWorkImages(work)[0] || "";
        image.alt = work.title || "作品画像";
        image.loading = "lazy";

        imageWrap.appendChild(image);

        const title = document.createElement("h3");
        title.className = "work-card-title";
        title.textContent = work.title || "タイトルなし";

        const category = document.createElement("p");
        category.className = "work-card-category";
        const workCategories = Array.isArray(work.categories)
            ? work.categories
            : (work.category ? [work.category] : []);
        category.textContent = workCategories.length ? workCategories.join(" / ") : "未分類";

        card.append(
            imageWrap,
            title,
            category
        );

        if (work.date) {
            const date = document.createElement("p");
            date.className = "work-card-date";
            date.textContent = formatWorkDate(work.date);
            card.appendChild(date);
        }

        card.addEventListener("click", () => {
            openModal(work);
        });

        card.addEventListener("keydown", event => {
            if (
                event.key === "Enter" ||
                event.key === " "
            ) {
                event.preventDefault();
                openModal(work);
            }
        });

        grid.appendChild(card);
    });
}


// ========================================
// 作品の拡大表示
// ========================================

function getWorkImages(work) {
    if (Array.isArray(work.images) && work.images.length) return work.images.filter(Boolean);
    return work.image ? [work.image] : [];
}

function openModal(work) {
    modalImages = getWorkImages(work);
    modalImageIndex = 0;
    updateModalImage();

    document.getElementById("modalTitle").textContent = work.title || "タイトルなし";
    const modalCategories = Array.isArray(work.categories)
        ? work.categories
        : (work.category ? [work.category] : []);
    document.getElementById("modalCategory").textContent =
        modalCategories.length ? modalCategories.join(" / ") : "未分類";
    const modalDate = document.getElementById("modalDate");
    modalDate.textContent = work.date ? formatWorkDate(work.date) : "";
    modalDate.classList.toggle("hidden", !work.date);
    document.getElementById("modalDescription").textContent = work.description || "";

    modalRoot.classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function updateModalImage() {
    const image = document.getElementById("modalImage");
    image.src = modalImages[modalImageIndex] || "";
    image.alt = `作品画像 ${modalImageIndex + 1} / ${modalImages.length}`;
    // 1枚の場合は矢印用の左右余白をなくし、画像本来の縦横比・表示寸法を優先する。
    // 複数枚の場合のみ矢印用の3カラムレイアウトを使用する。
    const stage = image.closest(".modal-image-stage");
    const multiple = modalImages.length > 1;
    if (stage) stage.classList.toggle("single-image", !multiple);
    image.style.display = "block";
    image.style.objectFit = "contain";
    if (multiple) {
        image.style.width = "100%";
        image.style.maxWidth = "100%";
        image.style.height = "65vh";
        image.style.maxHeight = "65vh";
    } else {
        image.style.width = "auto";
        image.style.maxWidth = "min(80vw, 820px)";
        image.style.height = "auto";
        image.style.maxHeight = "78vh";
    }
    const counter = document.getElementById("modalImageCounter");
    if (counter) counter.textContent = `${modalImageIndex + 1} / ${modalImages.length}`;
    const previous = document.getElementById("modalPrevious");
    const next = document.getElementById("modalNext");
    if (previous) previous.classList.toggle("hidden", !multiple);
    if (next) next.classList.toggle("hidden", !multiple);
    if (counter) counter.classList.toggle("hidden", !multiple);
}

function moveModalImage(direction) {
    if (modalImages.length < 2) return;
    modalImageIndex = (modalImageIndex + direction + modalImages.length) % modalImages.length;
    updateModalImage();
}


function closeModal() {
    modalRoot.classList.add("hidden");
    document.body.style.overflow = "";

    document.getElementById("modalImage").removeAttribute("src");
    modalImages = [];
    modalImageIndex = 0;
}


document.getElementById("modalPrevious")?.addEventListener("click", () => moveModalImage(-1));
document.getElementById("modalNext")?.addEventListener("click", () => moveModalImage(1));
modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);

document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModal();
    if (!modalRoot.classList.contains("hidden") && event.key === "ArrowRight") moveModalImage(1);
    if (!modalRoot.classList.contains("hidden") && event.key === "ArrowLeft") moveModalImage(-1);
});


// ========================================
// 公開画面・編集画面の切り替え
// ========================================

function showPublicView() {
    previewMode = false;
    document.body.classList.remove("edit-mode");

    publicView.classList.remove("hidden");
    editView.classList.add("hidden");

    editTab.classList.remove("active");

    renderPublic();
}


function showEditView() {
    previewMode = false;
    document.body.classList.add("edit-mode");

    publicView.classList.add("hidden");
    editView.classList.remove("hidden");

    editTab.classList.add("active");

    renderEditor();
}


editTab.addEventListener("click", showEditView);

document.getElementById("siteLogo").addEventListener("click", event => {
    event.preventDefault();
    showPublicView();
});


// ========================================
// 編集メニューの切り替え
// ========================================

document.querySelectorAll(".sidebar-button").forEach(button => {
    button.addEventListener("click", () => {
        currentPanel = button.dataset.panel;
        renderEditor();
    });
});


// ========================================
// 編集画面を描画する
// ========================================

function renderEditor() {
    document.querySelectorAll(".sidebar-button").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.panel === currentPanel
        );
    });

    const titles = {
        profile: "プロフィール",
        works: "作品管理",
        categories: "カテゴリ管理",
        design: "デザイン設定"
    };

    editorTitle.textContent = titles[currentPanel] || "編集";

    if (currentPanel === "profile") {
        renderProfileEditor();
    } else if (currentPanel === "works") {
        renderWorksEditor();
    } else if (currentPanel === "categories") {
        renderCategoriesEditor();
    } else if (currentPanel === "design") {
        renderDesignEditor();
    }
}


// ========================================
// ファイルをデータURLとして読み込む
// ========================================

// 元画像を変換せず、そのままデータURLとして読み込む。
// ピクセル寸法・ファイル形式・画質を変更しない。
function readImageFile(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            resolve("");
            return;
        }

        if (!file.type.startsWith("image/")) {
            reject(new Error("画像ファイルを選択してください。"));
            return;
        }

        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => {
            reject(new Error("画像を読み込めませんでした。"));
        };
        reader.readAsDataURL(file);
    });
}

// ========================================
// 画像アップロード用の入力欄を作る
// ========================================

function imageFieldHTML(label, inputId, currentImage) {
    const previewId = `${inputId}Preview`;
    return `
        <div class="form-field">
            <label for="${inputId}">${escapeHTML(label)}</label>
            <input class="form-input" type="file" id="${inputId}" accept="image/*">
            <div class="image-preview-area" id="${previewId}" aria-live="polite">
                ${currentImage
                    ? `<img class="image-preview" src="${currentImage}" alt="${escapeHTML(label)}のプレビュー">`
                    : `<div class="preview-empty">画像はまだ設定されていません。</div>`}
            </div>
        </div>
    `;
}


// ========================================
// プロフィール編集画面
// ========================================

function renderProfileEditor() {
    editorContent.innerHTML = `
        <div class="editor-panel">

            <section class="form-card">
                <h2>プロフィール情報</h2>

                <div class="form-field">
                    <label for="editName">表示名</label>

                    <input
                        class="form-input"
                        id="editName"
                        type="text"
                        value="${escapeHTML(draft.name)}"
                    >
                </div>

                <div class="form-field">
                    <label for="editActivity">活動内容</label>

                    <input
                        class="form-input"
                        id="editActivity"
                        type="text"
                        value="${escapeHTML(draft.activity)}"
                    >
                </div>

                <div class="form-field">
                    <label for="editIntro">自己紹介</label>

                    <textarea
                        class="form-textarea"
                        id="editIntro"
                    >${escapeHTML(draft.intro)}</textarea>
                </div>

                ${imageFieldHTML(
                    "メイン画像",
                    "editHeroImage",
                    draft.heroImage
                )}

                ${imageFieldHTML(
                    "プロフィール画像",
                    "editAvatar",
                    draft.avatar
                )}

                <div class="form-actions">
                    <button
                        type="button"
                        class="primary-button"
                        id="saveProfileButton"
                    >
                        プロフィールを保存
                    </button>
                </div>
            </section>


            <section class="form-card">
                <h2>SNS・Webサイトのリンク</h2>

                <p class="panel-description">
                    表示名とURLを登録します。
                    公開画面では表示名がクリックできるリンクになります。
                </p>

                <div
                    id="linkEditorList"
                    class="link-editor-list"
                ></div>

                <div class="form-actions">
                    <button
                        type="button"
                        class="secondary-button"
                        id="addLinkButton"
                    >
                        ＋ リンクを追加
                    </button>

                    <button
                        type="button"
                        class="primary-button"
                        id="saveLinksButton"
                    >
                        リンクを保存
                    </button>
                </div>
            </section>


            <section class="form-card">
                <h2>作品一覧の見出し</h2>

                <div class="form-field">
                    <label for="editEyebrow">小見出し</label>

                    <input
                        class="form-input"
                        id="editEyebrow"
                        type="text"
                        value="${escapeHTML(draft.eyebrow)}"
                    >
                </div>

                <div class="form-field">
                    <label for="editHeadline">大見出し</label>

                    <input
                        class="form-input"
                        id="editHeadline"
                        type="text"
                        value="${escapeHTML(draft.headline)}"
                    >
                </div>

                <div class="form-actions">
                    <button
                        type="button"
                        class="primary-button"
                        id="saveHeadingButton"
                    >
                        見出しを保存
                    </button>
                </div>
            </section>

        </div>
    `;

    renderLinkEditorList();

    document.getElementById("saveProfileButton")
        .addEventListener("click", saveProfile);

    document.getElementById("addLinkButton")
        .addEventListener("click", addLink);

    document.getElementById("saveLinksButton")
        .addEventListener("click", saveLinks);

    document.getElementById("saveHeadingButton")
        .addEventListener("click", saveHeadings);

    connectImageInput("editHeroImage", "heroImage");
    connectImageInput("editAvatar", "avatar");
}


// ========================================
// 画像選択欄を接続する
// ========================================

function connectImageInput(inputId, dataKey) {
    const input = document.getElementById(inputId);

    input.addEventListener("change", async () => {
        const file = input.files[0];

        if (!file) {
            return;
        }

        try {
            const imageData = await readImageFile(file);
            draft[dataKey] = imageData;

            // 選択直後に、ファイル入力欄のすぐ下へ画像を表示する
            const preview = document.getElementById(`${inputId}Preview`);
            if (preview) {
                const img = document.createElement("img");
                img.className = "image-preview";
                img.alt = dataKey === "heroImage" ? "メイン画像のプレビュー" : "プロフィール画像のプレビュー";
                img.src = imageData;
                preview.replaceChildren(img);
            }

            saveDraft("画像を更新しました。");
        } catch (error) {
            alert(error.message);
        }
    });
}


// ========================================
// プロフィール情報を保存する
// ========================================

function saveProfile() {
    draft.name = cleanText(
        document.getElementById("editName").value
    );

    draft.activity = cleanText(
        document.getElementById("editActivity").value
    );

    draft.intro =
        document.getElementById("editIntro").value.trim();

    saveDraft("プロフィールを保存しました。");
    renderPublic();
}


// ========================================
// SNSリンクの編集リスト
// ========================================

function renderLinkEditorList() {
    const container = document.getElementById("linkEditorList");

    container.innerHTML = "";

    if (draft.socialLinks.length === 0) {
        container.innerHTML = `
            <div class="preview-empty">
                リンクはまだ登録されていません。
            </div>
        `;
    }

    draft.socialLinks.forEach((link, index) => {
        const item = document.createElement("div");

        item.className = "link-editor-item";

        item.innerHTML = `
            <div class="form-field">
                <label for="linkLabel${index}">
                    表示名
                </label>

                <input
                    class="form-input"
                    id="linkLabel${index}"
                    type="text"
                    value="${escapeHTML(link.label)}"
                    placeholder="例：Instagram"
                >
            </div>

            <div class="form-field">
                <label for="linkUrl${index}">
                    URL
                </label>

                <input
                    class="form-input"
                    id="linkUrl${index}"
                    type="url"
                    value="${escapeHTML(link.url)}"
                    placeholder="https://example.com"
                >
            </div>

            <button
                type="button"
                class="danger-button"
                data-remove-link="${index}"
            >
                削除
            </button>
        `;

        container.appendChild(item);
    });

    container.querySelectorAll("[data-remove-link]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const index = Number(button.dataset.removeLink);

                draft.socialLinks.splice(index, 1);

                saveDraft("リンクを削除しました。");
                renderLinkEditorList();
            });
        });
}


// ========================================
// SNSリンクを追加する
// ========================================

function addLink() {
    draft.socialLinks.push({
        id: createId(),
        label: "",
        url: ""
    });

    saveDraft("新しいリンク欄を追加しました。");
    renderLinkEditorList();
}


// ========================================
// SNSリンクを保存する
// ========================================

function saveLinks() {
    const updatedLinks = [];

    for (
        let index = 0;
        index < draft.socialLinks.length;
        index++
    ) {
        const labelInput = document.getElementById(
            `linkLabel${index}`
        );

        const urlInput = document.getElementById(
            `linkUrl${index}`
        );

        const label = cleanText(labelInput?.value);
        const url = cleanText(urlInput?.value);

        if (!label && !url) {
            continue;
        }

        if (!label) {
            alert("リンクの表示名を入力してください。");
            return;
        }

        if (!isValidHttpUrl(url)) {
            alert(
                `「${label}」のURLが正しくありません。\n` +
                "http:// または https:// から始まるURLを入力してください。"
            );

            return;
        }

        updatedLinks.push({
            id: draft.socialLinks[index].id || createId(),
            label,
            url
        });
    }

    draft.socialLinks = updatedLinks;

    saveDraft("リンクを保存しました。");
    renderLinkEditorList();
    renderPublic();
}


// ========================================
// 見出しを保存する
// ========================================

function saveHeadings() {
    draft.eyebrow = cleanText(
        document.getElementById("editEyebrow").value
    );

    draft.headline = cleanText(
        document.getElementById("editHeadline").value
    ).replace(/[✧✦☆★]/g, "").trim();

    saveDraft("見出しを保存しました。");
    renderPublic();
}


// ========================================
// カテゴリ管理画面
// ========================================

function renderCategoriesEditor() {
    editorContent.innerHTML = `
        <div class="editor-panel">

            <section class="form-card">
                <h2>カテゴリを追加</h2>

                <p class="panel-description">
                    作品を分類するカテゴリを自由に作成できます。
                    同じ名前のカテゴリは登録できません。
                </p>

                <form id="addCategoryForm" class="inline-form">
                    <div class="form-field">
                        <label for="newCategoryName">
                            カテゴリ名
                        </label>

                        <input
                            class="form-input"
                            id="newCategoryName"
                            type="text"
                            placeholder="例：オリジナル、ファンアート"
                            required
                        >
                    </div>

                    <button
                        type="submit"
                        class="primary-button"
                    >
                        カテゴリを追加
                    </button>
                </form>
            </section>


            <section class="form-card">
                <h2>登録済みカテゴリ</h2>

                <p class="panel-description">
                    カテゴリを削除すると、そのカテゴリを使用していた
                    作品は未分類になります。
                </p>

                <div
                    id="categoryManagerList"
                    class="category-manager-list"
                ></div>
            </section>

        </div>
    `;

    renderCategoryManagerList();

    document.getElementById("addCategoryForm")
        .addEventListener("submit", event => {
            event.preventDefault();
            addCategory();
        });
}


// ========================================
// 登録済みカテゴリを表示する
// ========================================

function renderCategoryManagerList() {
    const container = document.getElementById("categoryManagerList");

    container.innerHTML = "";

    if (draft.categories.length === 0) {
        container.innerHTML = `
            <div class="preview-empty">
                カテゴリはまだ登録されていません。
            </div>
        `;
        return;
    }

    draft.categories.forEach(category => {
        const item = document.createElement("div");
        item.className = "category-manager-item";
        item.dataset.category = category;

        const dragHandle = document.createElement("button");
        dragHandle.type = "button";
        dragHandle.className = "category-drag-handle";
        dragHandle.textContent = "☰";
        dragHandle.draggable = true;
        dragHandle.setAttribute("aria-label", `${category}をドラッグして並べ替え`);
        dragHandle.title = "つかんでドラッグすると順番を変更できます";

        dragHandle.addEventListener("dragstart", event => {
            item.classList.add("is-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", category);
        });

        dragHandle.addEventListener("dragend", () => {
            container.querySelectorAll(".category-manager-item").forEach(row => {
                row.classList.remove("is-dragging", "is-drag-over");
            });
        });

        item.addEventListener("dragover", event => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";

            const movingCategory = event.dataTransfer.getData("text/plain");
            if (movingCategory && item.dataset.category !== movingCategory) {
                container.querySelectorAll(".category-manager-item").forEach(row => {
                    row.classList.remove("is-drag-over");
                });
                item.classList.add("is-drag-over");
            }
        });

        item.addEventListener("dragleave", event => {
            if (!item.contains(event.relatedTarget)) {
                item.classList.remove("is-drag-over");
            }
        });

        item.addEventListener("drop", event => {
            event.preventDefault();
            item.classList.remove("is-drag-over");

            const draggedCategory = event.dataTransfer.getData("text/plain");
            const fromIndex = draft.categories.indexOf(draggedCategory);
            const toIndex = draft.categories.indexOf(category);

            if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
                return;
            }

            const [movedCategory] = draft.categories.splice(fromIndex, 1);
            draft.categories.splice(toIndex, 0, movedCategory);

            saveDraft("カテゴリの順番を変更しました。");
            renderCategoriesEditor();
            renderPublic();
        });

        const name = document.createElement("span");
        name.className = "category-manager-name";
        name.textContent = category;

        const actions = document.createElement("div");
        actions.className = "category-manager-actions";

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "danger-button";
        deleteButton.textContent = "削除";
        deleteButton.addEventListener("click", () => {
            deleteCategory(category);
        });

        actions.appendChild(deleteButton);
        item.append(dragHandle, name, actions);
        container.appendChild(item);
    });
}


// ========================================
// カテゴリを追加する
// ========================================

function addCategory() {
    const input = document.getElementById("newCategoryName");
    const category = cleanText(input.value);

    if (!category) {
        alert("カテゴリ名を入力してください。");
        return;
    }

    if (category === "自主制作") {
        alert(
            "「自主制作」は初期カテゴリとして使用しません。\n" +
            "別のカテゴリ名を入力してください。"
        );

        return;
    }

    const alreadyExists = draft.categories.some(existing => {
        return existing.toLowerCase() === category.toLowerCase();
    });

    if (alreadyExists) {
        alert("同じ名前のカテゴリは登録できません。");
        return;
    }

    draft.categories.push(category);

    saveDraft("カテゴリを追加しました。");

    renderCategoriesEditor();
    renderPublic();
}


// ========================================
// カテゴリを削除する
// ========================================

function deleteCategory(category) {
    const confirmed = confirm(
        `カテゴリ「${category}」を削除しますか？\n` +
        "このカテゴリを使用している作品は未分類になります。"
    );

    if (!confirmed) {
        return;
    }

    draft.categories = draft.categories.filter(existing => {
        return existing !== category;
    });

    draft.works.forEach(work => {
        const workCategories = Array.isArray(work.categories)
            ? work.categories
            : (work.category ? [work.category] : []);
        work.categories = workCategories.filter(item => item !== category);
        work.category = work.categories[0] || "";
    });

    if (currentFilter === category) {
        currentFilter = "ALL";
    }

    saveDraft("カテゴリを削除しました。");

    renderCategoriesEditor();
    renderPublic();
}


// ========================================
// 作品管理画面
// ========================================

function renderWorksEditor() {
    const editingWork = draft.works.find(work => {
        return work.id === editingWorkId;
    });

    editorContent.innerHTML = `
        <div class="editor-panel">

            <section class="form-card">
                <h2>
                    ${editingWork ? "作品を編集" : "作品を追加"}
                </h2>

                <p class="panel-description">
                    作品画像を選択し、タイトルやカテゴリを設定します。
                </p>

                <form id="workForm">

                    <div class="form-field">
                        <label for="workTitle">作品タイトル</label>

                        <input
                            class="form-input"
                            id="workTitle"
                            type="text"
                            value="${escapeHTML(editingWork?.title || "")}"
                            placeholder="作品名"
                        >
                    </div>


                    <div class="form-field">
                        <label for="workImage">作品画像</label>

                        <input
                            class="form-input"
                            id="workImage"
                            type="file"
                            accept="image/*"
                            multiple
                            
                        >

                        <small>複数の画像を選択できます。編集時に追加した画像は、現在の画像の後ろに追加されます。</small>
                        <div class="image-preview-area work-multi-preview" id="workImagePreview" aria-live="polite"></div>
                    </div>


                    <div class="form-field">
                        <label for="workCategory">カテゴリ</label>

                        <div class="work-category-checkboxes" id="workCategory">
                            ${draft.categories.map((category, categoryIndex) => `
                                <label class="work-category-checkbox">
                                    <input
                                        type="checkbox"
                                        name="workCategories"
                                        value="${escapeHTML(category)}"
                                        ${(
                                            editingWork?.categories ||
                                            (editingWork?.category ? [editingWork.category] : [])
                                        ).includes(category) ? "checked" : ""}
                                    >
                                    <span>${escapeHTML(category)}</span>
                                </label>
                            `).join("")}
                        </div>
                        <small id="workCategoryHelp">当てはまるカテゴリにチェックを入れてください。複数選択できます。未選択の場合は未分類になります。</small>

                        ${
                            draft.categories.length === 0
                                ? `
                                    <small>
                                        カテゴリがありません。
                                        必要に応じてカテゴリ管理から追加してください。
                                    </small>
                                `
                                : ""
                        }
                    </div>


                    <div class="form-field">
                        <label for="workDate">掲載日（年月日・任意）</label>

                        <input
                            class="form-input"
                            id="workDate"
                            type="date"
                            value="${escapeHTML(editingWork?.date || "")}"
                        >
                        <small id="workDateWeekday" class="date-weekday-preview" aria-live="polite"></small>
                    </div>


                    <div class="form-field">
                        <label for="workDescription">
                            作品の説明
                        </label>

                        <textarea
                            class="form-textarea"
                            id="workDescription"
                            placeholder="作品についての説明（任意）"
                        >${escapeHTML(editingWork?.description || "")}</textarea>
                    </div>


                    <div class="form-actions">
                        <button
                            type="submit"
                            class="primary-button"
                        >
                            ${editingWork ? "変更を保存" : "作品を追加"}
                        </button>

                        <button
                            type="button"
                            class="secondary-button"
                            id="cancelWorkEditButton"
                        >
                            ${editingWork ? "編集をキャンセル" : "入力をリセット"}
                        </button>
                    </div>

                </form>
            </section>


            <section class="form-card">
                <h2>登録済み作品</h2>

                <div
                    id="workEditorList"
                    class="work-editor-list"
                ></div>
            </section>

        </div>
    `;

    renderWorkEditorList();

    document.getElementById("workForm")
        .addEventListener("submit", saveWork);

    // 登録済み画像を編集画面に表示し、個別に削除できるようにする。
    editingWorkImages = editingWork ? getWorkImages(editingWork).slice() : [];
    renderWorkImagePreviews();

    const workImageInput = document.getElementById("workImage");
    workImageInput.addEventListener("change", async () => {
        const files = Array.from(workImageInput.files || []);
        if (!files.length) return;
        try {
            for (const file of files) editingWorkImages.push(await readImageFile(file));
            renderWorkImagePreviews();
            workImageInput.value = "";
        } catch (error) {
            alert(error.message || "画像を読み込めませんでした。");
        }
    });

    const workDateInput = document.getElementById("workDate");
    if (workDateInput) {
        workDateInput.addEventListener("input", updateWorkDateWeekday);
        workDateInput.addEventListener("change", updateWorkDateWeekday);
        updateWorkDateWeekday();
    }

    document.getElementById("cancelWorkEditButton")
        .addEventListener("click", () => {
            editingWorkId = null;
            renderWorksEditor();
        });
}


function renderWorkImagePreviews() {
    const preview = document.getElementById("workImagePreview");
    if (!preview) return;
    preview.replaceChildren();
    if (!editingWorkImages.length) {
        const empty = document.createElement("div");
        empty.className = "preview-empty";
        empty.textContent = "画像はまだ選択されていません。";
        preview.appendChild(empty);
        return;
    }
    editingWorkImages.forEach((src, index) => {
        const item = document.createElement("div");
        item.className = "work-image-preview-item";
        const img = document.createElement("img");
        img.className = "image-preview";
        img.src = src;
        img.alt = `作品画像 ${index + 1}`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger-button work-image-remove";
        remove.textContent = "この画像を削除";
        remove.addEventListener("click", () => {
            editingWorkImages.splice(index, 1);
            renderWorkImagePreviews();
        });
        item.append(img, remove);
        preview.appendChild(item);
    });
}

// ========================================
// 登録済み作品を表示する
// ========================================

function renderWorkEditorList() {
    const container = document.getElementById("workEditorList");

    container.innerHTML = "";

    if (draft.works.length === 0) {
        container.innerHTML = `
            <div class="preview-empty">
                作品はまだ登録されていません。
            </div>
        `;

        return;
    }

    draft.works.forEach((work, workIndex) => {
        const item = document.createElement("article");

        item.className = "work-editor-item";
        item.dataset.workId = work.id;

        // 作品の順番を変更するためのドラッグハンドル
        const dragHandle = document.createElement("button");
        dragHandle.type = "button";
        dragHandle.className = "work-drag-handle";
        dragHandle.textContent = "☰";
        dragHandle.draggable = true;
        dragHandle.setAttribute(
            "aria-label",
            `${work.title || "タイトルなし"}をドラッグして掲載順を変更`
        );
        dragHandle.title = "つかんでドラッグすると掲載順を変更できます";

        dragHandle.addEventListener("dragstart", event => {
            item.classList.add("is-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", work.id);
        });

        dragHandle.addEventListener("dragend", () => {
            container.querySelectorAll(".work-editor-item").forEach(row => {
                row.classList.remove("is-dragging", "is-drag-over");
            });
        });

        item.addEventListener("dragover", event => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";

            const movingWorkId = event.dataTransfer.getData("text/plain");
            if (movingWorkId && item.dataset.workId !== movingWorkId) {
                container.querySelectorAll(".work-editor-item").forEach(row => {
                    row.classList.remove("is-drag-over");
                });
                item.classList.add("is-drag-over");
            }
        });

        item.addEventListener("dragleave", event => {
            if (!item.contains(event.relatedTarget)) {
                item.classList.remove("is-drag-over");
            }
        });

        item.addEventListener("drop", event => {
            event.preventDefault();
            item.classList.remove("is-drag-over");

            const draggedWorkId = event.dataTransfer.getData("text/plain");
            const fromIndex = draft.works.findIndex(entry => entry.id === draggedWorkId);
            const toIndex = draft.works.findIndex(entry => entry.id === work.id);

            if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
                return;
            }

            const [movedWork] = draft.works.splice(fromIndex, 1);
            draft.works.splice(toIndex, 0, movedWork);
            draft.works.forEach((entry, index) => {
                entry.order = index;
            });

            saveDraft("作品の掲載順を変更しました。");
            renderWorksEditor();
            renderPublic();
        });

        const image = document.createElement("img");
        image.className = "work-editor-thumbnail";
        image.src = getWorkImages(work)[0] || "";
        image.alt = work.title || "作品画像";

        const info = document.createElement("div");
        info.className = "work-editor-info";

        const title = document.createElement("h3");
        title.textContent = work.title || "タイトルなし";

        const category = document.createElement("p");
        const workCategories = Array.isArray(work.categories)
            ? work.categories
            : (work.category ? [work.category] : []);
        category.textContent =
            "カテゴリ：" + (workCategories.length ? workCategories.join(" / ") : "未分類");

        const description = document.createElement("p");
        description.textContent =
            work.description || "説明なし";

        const actions = document.createElement("div");
        actions.className = "work-editor-actions";

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "secondary-button";
        editButton.textContent = "編集";

        editButton.addEventListener("click", () => {
            editingWorkId = work.id;
            renderWorksEditor();

            editorContent.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "danger-button";
        deleteButton.textContent = "削除";

        deleteButton.addEventListener("click", () => {
            deleteWork(work.id);
        });

        actions.append(editButton, deleteButton);

        info.append(
            title,
            category,
            description,
            actions
        );

        item.append(dragHandle, image, info);

        container.appendChild(item);
    });
}


// ========================================
// 作品を追加・編集して保存する
// ========================================

async function saveWork(event) {
    event.preventDefault();
    const title = cleanText(document.getElementById("workTitle").value);
    const categories = Array.from(
        document.querySelectorAll('#workCategory input[name="workCategories"]:checked'),
        checkbox => checkbox.value
    ).filter(category => draft.categories.includes(category));
    const description = document.getElementById("workDescription").value.trim();
    const date = document.getElementById("workDate").value;
    const existingWork = draft.works.find(work => work.id === editingWorkId);
    const images = editingWorkImages.filter(Boolean);

    if (!images.length) {
        alert("作品画像を1枚以上選択してください。");
        return;
    }

    const workData = {
        id: existingWork?.id || createId(),
        title,
        images,
        // 画像データは images 配列だけに保存し、同じ大容量データを重複保持しない。
        // 旧形式の作品は getWorkImages() が work.image から読み込む。
        description,
        date,
        categories,
        category: categories[0] || "",
        order: existingWork?.order ?? draft.works.length
    };

    if (existingWork) {
        draft.works = draft.works.map(work => work.id === existingWork.id ? workData : work);
    } else {
        draft.works.push(workData);
    }
    draft.works.forEach((work, index) => { work.order = index; });
    editingWorkId = null;
    editingWorkImages = [];
    saveDraft("作品を保存しました。");
    renderWorksEditor();
    renderPublic();
}


// ========================================
// 作品を削除する
// ========================================

function deleteWork(workId) {
    const work = draft.works.find(item => item.id === workId);

    if (!work) {
        return;
    }

    const confirmed = confirm(
        `「${work.title || "タイトルなし"}」を削除しますか？`
    );

    if (!confirmed) {
        return;
    }

    draft.works = draft.works.filter(item => {
        return item.id !== workId;
    });
    draft.works.forEach((item, index) => {
        item.order = index;
    });

    if (editingWorkId === workId) {
        editingWorkId = null;
    }

    saveDraft("作品を削除しました。");

    renderWorksEditor();
    renderPublic();
}


// ========================================
// デザイン設定画面
// ========================================

function renderDesignEditor() {
    editorContent.innerHTML = `
        <div class="editor-panel">

            <section class="form-card">
                <h2>カラー設定</h2>

                <div class="form-row">
                    <div class="form-field">
                        <label for="designBg">背景色</label>

                        <input
                            class="form-input"
                            id="designBg"
                            type="color"
                            value="${escapeHTML(draft.bg)}"
                        >
                    </div>

                    <div class="form-field">
                        <label for="designText">文字色</label>

                        <input
                            class="form-input"
                            id="designText"
                            type="color"
                            value="${escapeHTML(draft.text)}"
                        >
                    </div>
                </div>

                <div class="form-field">
                    <label for="designAccent">
                        アクセントカラー
                    </label>

                    <input
                        class="form-input"
                        id="designAccent"
                        type="color"
                        value="${escapeHTML(draft.accent)}"
                    >
                </div>
            </section>


            <section class="form-card">
                <h2>文字設定</h2>

                <div class="form-field">
                    <label for="designFont">フォント</label>

                    <select class="form-select" id="designFont">
                        <option
                            value="gothic"
                            ${draft.font === "gothic" ? "selected" : ""}
                        >
                            ゴシック体
                        </option>

                        <option
                            value="serif"
                            ${draft.font === "serif" ? "selected" : ""}
                        >
                            明朝体
                        </option>
                    </select>
                </div>

                <div class="form-field">
                    <label for="designWeight">文字の太さ</label>

                    <select class="form-select" id="designWeight">
                        <option
                            value="400"
                            ${draft.weight === "400" ? "selected" : ""}
                        >
                            標準
                        </option>

                        <option
                            value="600"
                            ${draft.weight === "600" ? "selected" : ""}
                        >
                            やや太い
                        </option>

                        <option
                            value="700"
                            ${draft.weight === "700" ? "selected" : ""}
                        >
                            太い
                        </option>
                    </select>
                </div>

                <label class="checkbox-row">
                    <input
                        id="designItalic"
                        type="checkbox"
                        ${draft.italic ? "checked" : ""}
                    >

                    文字を斜体にする
                </label>
            </section>


            <div class="form-actions">
                <button
                    type="button"
                    id="saveDesignButton"
                    class="primary-button"
                >
                    デザインを保存
                </button>

                <button
                    type="button"
                    id="resetDesignButton"
                    class="secondary-button"
                >
                    デザインを初期値に戻す
                </button>
            </div>

        </div>
    `;

    document.getElementById("saveDesignButton")
        .addEventListener("click", saveDesign);

    document.getElementById("resetDesignButton")
        .addEventListener("click", resetDesign);
}


// ========================================
// デザイン設定を保存する
// ========================================

function saveDesign() {
    draft.bg = document.getElementById("designBg").value;
    draft.text = document.getElementById("designText").value;
    draft.accent = document.getElementById("designAccent").value;

    draft.font = document.getElementById("designFont").value;

    draft.weight = document.getElementById("designWeight").value;

    draft.italic =
        document.getElementById("designItalic").checked;

    saveDraft("デザインを保存しました。");

    renderPublic();
}


// ========================================
// デザイン設定を初期値に戻す
// ========================================

function resetDesign() {
    const confirmed = confirm(
        "デザイン設定を初期値に戻しますか？"
    );

    if (!confirmed) {
        return;
    }

    draft.bg = defaults.bg;
    draft.text = defaults.text;
    draft.accent = defaults.accent;

    draft.font = defaults.font;
    draft.weight = defaults.weight;
    draft.italic = defaults.italic;

    saveDraft("デザインを初期値に戻しました。");

    renderDesignEditor();
    renderPublic();
}


// ========================================
// プレビュー
// ========================================

previewButton.addEventListener("click", () => {
    previewMode = true;

    editView.classList.add("hidden");
    document.body.classList.remove("edit-mode");
    publicView.classList.remove("hidden");

    publicTab.classList.remove("active");
    editTab.classList.remove("active");

    renderPublic();

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
});


// ========================================
// 編集内容を保存して公開画面でプレビューする
// ========================================

publishButton.addEventListener("click", () => {
    const confirmed = confirm(
        "現在の編集内容を保存し、公開画面でプレビューしますか？\n\n" +
        "この操作ではファイルのダウンロードは行いません。\n" +
        "GitHub Pagesの公開内容に反映する場合は、「データを書き出す」でZIPを作成し、ファイルをGitHubへ反映してください。"
    );

    if (!confirmed) return;

    // 編集内容を下書きとブラウザ内の公開データとして保存する。
    if (!persist(KEY_DRAFT, draft)) return;

    const nextPublished = cloneData(draft);
    if (!persist(KEY_PUB, nextPublished)) return;
    published = nextPublished;

    // 公開画面に切り替え、編集内容をプレビュー表示する。
    previewMode = true;
    document.body.classList.remove("edit-mode");
    editView.classList.add("hidden");
    publicView.classList.remove("hidden");

    if (publicTab) publicTab.classList.remove("active");
    if (editTab) editTab.classList.remove("active");

    renderPublic();
    window.scrollTo({ top: 0, behavior: "smooth" });
});

// ========================================
// 初期状態に戻す
// ========================================

resetButton.addEventListener("click", () => {
    const confirmed = confirm(
        "下書きと公開データを初期状態に戻しますか？\n" +
        "現在の登録内容は削除されます。"
    );

    if (!confirmed) {
        return;
    }

    draft = cloneData(defaults);
    published = cloneData(defaults);

    currentPanel = "profile";
    currentFilter = "ALL";
    editingWorkId = null;
    previewMode = false;

    persist(KEY_DRAFT, draft);
    persist(KEY_PUB, published);

    editorStatus.textContent =
        "初期状態に戻しました。";

    renderEditor();
    renderPublic();
});


// ========================================
// 起動時の初期表示
// ========================================

// IndexedDBの既存データを優先してから画面を描画します。
// 初回はportfolio-data.js / 従来のlocalStorageを初期値として使います。
(async function bootPortfolio() {
    try {
        const stored = await initializeIndexedDB();
        draft = upgradeData(stored.savedDraft || readStorage(KEY_DRAFT, fileData));
        published = upgradeData(
            isPublicPage
                ? fileData
                : (stored.savedPublished || readStorage(KEY_PUB, fileData))
        );
        if (!isPublicPage) {
            await Promise.all([idbSet(KEY_DRAFT, draft), idbSet(KEY_PUB, published)]);
        }
    } catch (error) {
        console.error("IndexedDBの初期化に失敗しました。", error);
        editorStatus && (editorStatus.textContent = "IndexedDBを利用できないため、ブラウザの保存設定を確認してください。");
    }
    renderPublic();
    renderEditor();
    showPublicView();
})();
