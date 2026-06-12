// Translation key-value type interface
export interface TranslationMap {
  [key: string]: string
}

// Define supported languages
export const supportedLocales = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja',
  'ko',
  'fr',
  'es-ES',
  'de-DE',
  'tr-TR',
  'id-ID',
  'ms-MY',
  'it-IT',
  'pl-PL',
  'vi-VN',
  'de',
  'es',
  'pt-BR',
  'da-DK'
]

// Context menu translations
export const contextMenuTranslations: Record<string, TranslationMap> = {
  'zh-CN': {
    copy: '复制',
    paste: '粘贴',
    cut: '剪切',
    selectAll: '全选',
    undo: '撤销',
    redo: '重做',
    saveImage: '图片另存为...',
    copyImage: '复制图片',
    open: '打开/隐藏',
    checkForUpdates: '检查更新',
    quit: '退出',
    translate: '翻译',
    askAI: '询问AI',
    newThreadFromSelection: '基于选区新建会话',
    file: '文件',
    edit: '编辑',
    view: '视图',
    window: '窗口',
    settings: '设置...',
    newConversation: '新建会话',
    newWindow: '新建窗口',
    closeWindow: '关闭窗口',
    quickSearch: '快速搜索',
    toggleSidebar: '显示/隐藏侧边栏',
    toggleWorkspace: '显示/隐藏工作区',
    cleanChatHistory: '清除聊天历史',
    deleteConversation: '删除会话',
    zoomIn: '放大',
    zoomOut: '缩小',
    resetZoom: '实际大小',
    showHide: '显示/隐藏 DeepChat'
  },
  'zh-TW': {
    copy: '複製',
    paste: '貼上',
    cut: '剪下',
    selectAll: '全選',
    undo: '復原',
    redo: '重做',
    saveImage: '圖片另存為...',
    copyImage: '複製圖片',
    open: '打開/隱藏',
    checkForUpdates: '檢查更新',
    quit: '退出',
    translate: '翻譯',
    askAI: '詢問AI',
    newThreadFromSelection: '基於選區新建會話',
    file: '檔案',
    edit: '編輯',
    view: '顯示',
    window: '視窗',
    settings: '設定...',
    newConversation: '新增會話',
    newWindow: '新增視窗',
    closeWindow: '關閉視窗',
    quickSearch: '快速搜尋',
    toggleSidebar: '顯示/隱藏側邊欄',
    toggleWorkspace: '顯示/隱藏工作區',
    cleanChatHistory: '清除聊天記錄',
    deleteConversation: '刪除會話',
    zoomIn: '放大',
    zoomOut: '縮小',
    resetZoom: '實際大小',
    showHide: '顯示/隱藏 DeepChat'
  },
  'en-US': {
    copy: 'Copy',
    paste: 'Paste',
    cut: 'Cut',
    selectAll: 'Select All',
    undo: 'Undo',
    redo: 'Redo',
    saveImage: 'Save Image...',
    copyImage: 'Copy Image',
    open: 'Open/Hide',
    checkForUpdates: 'Check for Updates',
    quit: 'Quit',
    translate: 'Translate',
    askAI: 'Ask AI',
    newThreadFromSelection: 'New Thread from Selection',
    file: 'File',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    settings: 'Settings...',
    newConversation: 'New Conversation',
    newWindow: 'New Window',
    closeWindow: 'Close Window',
    quickSearch: 'Quick Search',
    toggleSidebar: 'Toggle Sidebar',
    toggleWorkspace: 'Toggle Workspace',
    cleanChatHistory: 'Clear Chat History',
    deleteConversation: 'Delete Conversation',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    resetZoom: 'Actual Size',
    showHide: 'Show/Hide DeepChat'
  },
  ja: {
    copy: 'コピー',
    paste: '貼り付け',
    cut: '切り取り',
    selectAll: 'すべて選択',
    undo: '元に戻す',
    redo: 'やり直し',
    saveImage: '画像を保存...',
    copyImage: '画像をコピー',
    open: '開く/隠す',
    checkForUpdates: '更新を確認',
    quit: '終了',
    translate: '翻訳',
    askAI: 'AIに質問',
    newThreadFromSelection: '選択範囲から新規スレッド'
  },
  ko: {
    copy: '복사',
    paste: '붙여넣기',
    cut: '잘라내기',
    selectAll: '모두 선택',
    undo: '실행 취소',
    redo: '다시 실행',
    saveImage: '이미지 저장...',
    copyImage: '이미지 복사',
    open: '열기/숨기기',
    checkForUpdates: '업데이트 확인',
    quit: '종료',
    translate: '번역',
    askAI: 'AI에게 질문',
    newThreadFromSelection: '선택 영역에서 새 스레드'
  },
  fr: {
    copy: 'Copier',
    paste: 'Coller',
    cut: 'Couper',
    selectAll: 'Tout sélectionner',
    undo: 'Annuler',
    redo: 'Rétablir',
    saveImage: "Enregistrer l'image...",
    copyImage: "Copier l'image",
    open: 'Ouvrir/Masquer',
    checkForUpdates: 'Vérifier les mises à jour',
    quit: 'Quitter',
    translate: 'Traduire',
    askAI: "Demander à l'AI",
    newThreadFromSelection: 'Nouveau fil depuis la sélection'
  },
  de: {
    copy: 'Kopieren',
    paste: 'Einfügen',
    cut: 'Ausschneiden',
    selectAll: 'Alles auswählen',
    undo: 'Rückgängig',
    redo: 'Wiederholen',
    saveImage: 'Bild speichern...',
    copyImage: 'Bild kopieren',
    open: 'Öffnen/Verstecken',
    checkForUpdates: 'Nach Updates suchen',
    quit: 'Beenden',
    translate: 'Übersetzen',
    askAI: 'KI fragen',
    newThreadFromSelection: 'Neuer Thread aus Auswahl'
  },
  es: {
    copy: 'Copiar',
    paste: 'Pegar',
    cut: 'Cortar',
    selectAll: 'Seleccionar todo',
    undo: 'Deshacer',
    redo: 'Rehacer',
    saveImage: 'Guardar imagen...',
    copyImage: 'Copiar imagen',
    open: 'Abrir/Esconder',
    checkForUpdates: 'Comprobar actualizaciones',
    quit: 'Salir',
    translate: 'Traducir',
    askAI: 'Preguntar a la AI',
    newThreadFromSelection: 'Nuevo hilo desde selección'
  },
  'pt-BR': {
    copy: 'Copiar',
    paste: 'Colar',
    cut: 'Recortar',
    selectAll: 'Selecionar Tudo',
    undo: 'Desfazer',
    redo: 'Refazer',
    saveImage: 'Salvar Imagem...',
    copyImage: 'Copiar Imagem',
    open: 'Abrir/Esconder',
    checkForUpdates: 'Verificar por atualizações',
    quit: 'Sair',
    translate: 'Traduzir',
    askAI: 'Perguntar à IA',
    newThreadFromSelection: 'Novo tópico da seleção'
  },
  'da-DK': {
    copy: 'Kopiér',
    paste: 'Indsæt',
    cut: 'Klip',
    selectAll: 'Markér alt',
    undo: 'Fortryd',
    redo: 'Gendan',
    saveImage: 'Gem billede...',
    copyImage: 'Kopiér billede',
    open: 'Åbn/skjul',
    checkForUpdates: 'Søg efter opdateringer',
    quit: 'Afslut',
    translate: 'Oversæt',
    askAI: 'Spørg AI',
    newThreadFromSelection: 'Ny tråd fra markering'
  }
}

Object.assign(contextMenuTranslations, {
  'es-ES': {
    copy: 'Copiar',
    paste: 'Pegar',
    cut: 'Cortar',
    selectAll: 'Seleccionar todo',
    undo: 'Deshacer',
    redo: 'Rehacer',
    saveImage: 'Guardar imagen...',
    copyImage: 'Copiar imagen',
    open: 'Abrir/Ocultar',
    checkForUpdates: 'Buscar actualizaciones',
    quit: 'Salir',
    translate: 'Traducir',
    askAI: 'Preguntar a la IA',
    newThreadFromSelection: 'Nuevo hilo desde la selección',
    file: 'Archivo',
    edit: 'Editar',
    view: 'Ver',
    window: 'Ventana',
    settings: 'Ajustes...',
    newConversation: 'Nueva conversación',
    newWindow: 'Nueva ventana',
    closeWindow: 'Cerrar ventana',
    quickSearch: 'Búsqueda rápida',
    toggleSidebar: 'Mostrar/ocultar barra lateral',
    toggleWorkspace: 'Mostrar/ocultar espacio de trabajo',
    cleanChatHistory: 'Borrar historial de chat',
    deleteConversation: 'Eliminar conversación',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    resetZoom: 'Tamaño real',
    showHide: 'Mostrar/ocultar DeepChat'
  },
  'de-DE': {
    copy: 'Kopieren',
    paste: 'Einfügen',
    cut: 'Ausschneiden',
    selectAll: 'Alles auswählen',
    undo: 'Rückgängig',
    redo: 'Wiederholen',
    saveImage: 'Bild speichern...',
    copyImage: 'Bild kopieren',
    open: 'Öffnen/Ausblenden',
    checkForUpdates: 'Nach Updates suchen',
    quit: 'Beenden',
    translate: 'Übersetzen',
    askAI: 'KI fragen',
    newThreadFromSelection: 'Neuer Thread aus Auswahl',
    file: 'Datei',
    edit: 'Bearbeiten',
    view: 'Ansicht',
    window: 'Fenster',
    settings: 'Einstellungen...',
    newConversation: 'Neue Unterhaltung',
    newWindow: 'Neues Fenster',
    closeWindow: 'Fenster schließen',
    quickSearch: 'Schnellsuche',
    toggleSidebar: 'Seitenleiste ein-/ausblenden',
    toggleWorkspace: 'Arbeitsbereich ein-/ausblenden',
    cleanChatHistory: 'Chatverlauf löschen',
    deleteConversation: 'Unterhaltung löschen',
    zoomIn: 'Vergrößern',
    zoomOut: 'Verkleinern',
    resetZoom: 'Originalgröße',
    showHide: 'DeepChat ein-/ausblenden'
  },
  'tr-TR': {
    copy: 'Kopyala',
    paste: 'Yapıştır',
    cut: 'Kes',
    selectAll: 'Tümünü seç',
    undo: 'Geri al',
    redo: 'Yinele',
    saveImage: 'Görseli kaydet...',
    copyImage: 'Görseli kopyala',
    open: 'Aç/Gizle',
    checkForUpdates: 'Güncellemeleri denetle',
    quit: 'Çık',
    translate: 'Çevir',
    askAI: "AI'a sor",
    newThreadFromSelection: 'Seçimden yeni konuşma',
    file: 'Dosya',
    edit: 'Düzenle',
    view: 'Görünüm',
    window: 'Pencere',
    settings: 'Ayarlar...',
    newConversation: 'Yeni konuşma',
    newWindow: 'Yeni pencere',
    closeWindow: 'Pencereyi kapat',
    quickSearch: 'Hızlı arama',
    toggleSidebar: 'Kenar çubuğunu göster/gizle',
    toggleWorkspace: 'Çalışma alanını göster/gizle',
    cleanChatHistory: 'Sohbet geçmişini temizle',
    deleteConversation: 'Konuşmayı sil',
    zoomIn: 'Yakınlaştır',
    zoomOut: 'Uzaklaştır',
    resetZoom: 'Gerçek boyut',
    showHide: "DeepChat'i göster/gizle"
  },
  'id-ID': {
    copy: 'Salin',
    paste: 'Tempel',
    cut: 'Potong',
    selectAll: 'Pilih semua',
    undo: 'Urungkan',
    redo: 'Ulangi',
    saveImage: 'Simpan gambar...',
    copyImage: 'Salin gambar',
    open: 'Buka/Sembunyikan',
    checkForUpdates: 'Periksa pembaruan',
    quit: 'Keluar',
    translate: 'Terjemahkan',
    askAI: 'Tanya AI',
    newThreadFromSelection: 'Percakapan baru dari pilihan',
    file: 'File',
    edit: 'Edit',
    view: 'Tampilan',
    window: 'Jendela',
    settings: 'Pengaturan...',
    newConversation: 'Percakapan baru',
    newWindow: 'Jendela baru',
    closeWindow: 'Tutup jendela',
    quickSearch: 'Pencarian cepat',
    toggleSidebar: 'Tampilkan/sembunyikan bilah sisi',
    toggleWorkspace: 'Tampilkan/sembunyikan ruang kerja',
    cleanChatHistory: 'Hapus riwayat chat',
    deleteConversation: 'Hapus percakapan',
    zoomIn: 'Perbesar',
    zoomOut: 'Perkecil',
    resetZoom: 'Ukuran sebenarnya',
    showHide: 'Tampilkan/sembunyikan DeepChat'
  },
  'ms-MY': {
    copy: 'Salin',
    paste: 'Tampal',
    cut: 'Potong',
    selectAll: 'Pilih semua',
    undo: 'Buat asal',
    redo: 'Buat semula',
    saveImage: 'Simpan imej...',
    copyImage: 'Salin imej',
    open: 'Buka/Sembunyikan',
    checkForUpdates: 'Semak kemas kini',
    quit: 'Keluar',
    translate: 'Terjemah',
    askAI: 'Tanya AI',
    newThreadFromSelection: 'Perbualan baharu daripada pilihan',
    file: 'Fail',
    edit: 'Edit',
    view: 'Paparan',
    window: 'Tetingkap',
    settings: 'Tetapan...',
    newConversation: 'Perbualan baharu',
    newWindow: 'Tetingkap baharu',
    closeWindow: 'Tutup tetingkap',
    quickSearch: 'Carian pantas',
    toggleSidebar: 'Tunjuk/sembunyikan bar sisi',
    toggleWorkspace: 'Tunjuk/sembunyikan ruang kerja',
    cleanChatHistory: 'Kosongkan sejarah sembang',
    deleteConversation: 'Padam perbualan',
    zoomIn: 'Zum masuk',
    zoomOut: 'Zum keluar',
    resetZoom: 'Saiz sebenar',
    showHide: 'Tunjuk/sembunyikan DeepChat'
  },
  'it-IT': {
    copy: 'Copia',
    paste: 'Incolla',
    cut: 'Taglia',
    selectAll: 'Seleziona tutto',
    undo: 'Annulla',
    redo: 'Ripeti',
    saveImage: 'Salva immagine...',
    copyImage: 'Copia immagine',
    open: 'Apri/Nascondi',
    checkForUpdates: 'Controlla aggiornamenti',
    quit: 'Esci',
    translate: 'Traduci',
    askAI: "Chiedi all'AI",
    newThreadFromSelection: 'Nuova conversazione dalla selezione',
    file: 'File',
    edit: 'Modifica',
    view: 'Vista',
    window: 'Finestra',
    settings: 'Impostazioni...',
    newConversation: 'Nuova conversazione',
    newWindow: 'Nuova finestra',
    closeWindow: 'Chiudi finestra',
    quickSearch: 'Ricerca rapida',
    toggleSidebar: 'Mostra/nascondi barra laterale',
    toggleWorkspace: 'Mostra/nascondi area di lavoro',
    cleanChatHistory: 'Cancella cronologia chat',
    deleteConversation: 'Elimina conversazione',
    zoomIn: 'Ingrandisci',
    zoomOut: 'Riduci',
    resetZoom: 'Dimensioni reali',
    showHide: 'Mostra/nascondi DeepChat'
  },
  'pl-PL': {
    copy: 'Kopiuj',
    paste: 'Wklej',
    cut: 'Wytnij',
    selectAll: 'Zaznacz wszystko',
    undo: 'Cofnij',
    redo: 'Ponów',
    saveImage: 'Zapisz obraz...',
    copyImage: 'Kopiuj obraz',
    open: 'Otwórz/Ukryj',
    checkForUpdates: 'Sprawdź aktualizacje',
    quit: 'Zakończ',
    translate: 'Tłumacz',
    askAI: 'Zapytaj AI',
    newThreadFromSelection: 'Nowy wątek z zaznaczenia',
    file: 'Plik',
    edit: 'Edycja',
    view: 'Widok',
    window: 'Okno',
    settings: 'Ustawienia...',
    newConversation: 'Nowa rozmowa',
    newWindow: 'Nowe okno',
    closeWindow: 'Zamknij okno',
    quickSearch: 'Szybkie wyszukiwanie',
    toggleSidebar: 'Pokaż/ukryj pasek boczny',
    toggleWorkspace: 'Pokaż/ukryj obszar roboczy',
    cleanChatHistory: 'Wyczyść historię czatu',
    deleteConversation: 'Usuń rozmowę',
    zoomIn: 'Powiększ',
    zoomOut: 'Pomniejsz',
    resetZoom: 'Rzeczywisty rozmiar',
    showHide: 'Pokaż/ukryj DeepChat'
  },
  'vi-VN': {
    copy: 'Sao chép',
    paste: 'Dán',
    cut: 'Cắt',
    selectAll: 'Chọn tất cả',
    undo: 'Hoàn tác',
    redo: 'Làm lại',
    saveImage: 'Lưu hình ảnh...',
    copyImage: 'Sao chép hình ảnh',
    open: 'Mở/Ẩn',
    checkForUpdates: 'Kiểm tra cập nhật',
    quit: 'Thoát',
    translate: 'Dịch',
    askAI: 'Hỏi AI',
    newThreadFromSelection: 'Tạo cuộc trò chuyện từ vùng chọn',
    file: 'Tệp',
    edit: 'Chỉnh sửa',
    view: 'Xem',
    window: 'Cửa sổ',
    settings: 'Cài đặt...',
    newConversation: 'Cuộc trò chuyện mới',
    newWindow: 'Cửa sổ mới',
    closeWindow: 'Đóng cửa sổ',
    quickSearch: 'Tìm kiếm nhanh',
    toggleSidebar: 'Hiện/ẩn thanh bên',
    toggleWorkspace: 'Hiện/ẩn không gian làm việc',
    cleanChatHistory: 'Xóa lịch sử trò chuyện',
    deleteConversation: 'Xóa cuộc trò chuyện',
    zoomIn: 'Phóng to',
    zoomOut: 'Thu nhỏ',
    resetZoom: 'Kích thước thực',
    showHide: 'Hiện/ẩn DeepChat'
  }
})

// Error message translations
export const errorMessageTranslations: Record<string, TranslationMap> = {
  'zh-CN': {
    mcpConnectionErrorTitle: 'MCP 连接错误',
    mcpConnectionErrorMessage: '连接到 MCP 服务器失败',
    addMcpServerErrorTitle: '添加服务器失败',
    addMcpServerDuplicateMessage: '服务器名称 "{serverName}" 已存在。请选择一个不同的名称。',
    getMcpToolListErrorTitle: '获取工具定义失败',
    getMcpToolListErrorMessage: "无法从服务器 '{serverName}' 获取工具列表: {errorMessage}",
    genericErrorTitle: '错误',
    genericErrorMessage: '发生了一个错误',
    needRagflowConfig: '需要提供RAGFlow知识库配置',
    needDifyConfig: '需要提供Dify知识库配置',
    needAtLeastOneRagflowConfig: '需要提供至少一个RAGFlow知识库配置',
    needAtLeastOneDifyConfig: '需要提供至少一个Dify知识库配置',
    needRagflowApiKey: '需要提供RAGFlow API Key',
    needDifyApiKey: '需要提供Dify API Key',
    needRagflowDatasetIds: '需要提供至少一个RAGFlow Dataset ID',
    needDifyDatasetId: '需要提供Dify Dataset ID',
    needRagflowEndpoint: '需要提供RAGFlow Endpoint',
    needDifyEndpoint: '需要提供Dify Endpoint',
    needKnowledgeBaseDescription: '需要提供对这个知识库的描述，以方便ai决定是否检索此知识库'
  },
  'zh-TW': {
    mcpConnectionErrorTitle: 'MCP 連接錯誤',
    mcpConnectionErrorMessage: '連接到 MCP 服務器失敗',
    addMcpServerErrorTitle: '添加服務器失敗',
    addMcpServerDuplicateMessage: '服務器名稱 "{serverName}" 已存在。請選擇一個不同的名稱。',
    getMcpToolListErrorTitle: '獲取工具定義失敗',
    getMcpToolListErrorMessage: "無法從服務器 '{serverName}' 獲取工具列表: {errorMessage}",
    genericErrorTitle: '錯誤',
    genericErrorMessage: '發生了一個錯誤',
    needRagflowConfig: '需要提供RAGFlow知識庫配置',
    needDifyConfig: '需要提供Dify知識庫配置',
    needAtLeastOneRagflowConfig: '需要提供至少一個RAGFlow知識庫配置',
    needAtLeastOneDifyConfig: '需要提供至少一個Dify知識庫配置',
    needRagflowApiKey: '需要提供RAGFlow API Key',
    needDifyApiKey: '需要提供Dify API Key',
    needRagflowDatasetIds: '需要提供至少一個RAGFlow Dataset ID',
    needDifyDatasetId: '需要提供Dify Dataset ID',
    needRagflowEndpoint: '需要提供RAGFlow Endpoint',
    needDifyEndpoint: '需要提供Dify Endpoint',
    needKnowledgeBaseDescription: '需要提供對這個知識庫的描述，以方便ai決定是否檢索此知識庫'
  },
  'en-US': {
    mcpConnectionErrorTitle: 'MCP Connection Error',
    mcpConnectionErrorMessage: 'Failed to connect to MCP server',
    addMcpServerErrorTitle: 'Failed to Add Server',
    addMcpServerDuplicateMessage:
      'Server name "{serverName}" already exists. Please choose a different name.',
    getMcpToolListErrorTitle: 'Failed to Get Tool Definitions',
    getMcpToolListErrorMessage:
      "Unable to retrieve tool list from server '{serverName}': {errorMessage}",
    genericErrorTitle: 'Error',
    genericErrorMessage: 'An error occurred',
    needRagflowConfig: 'Need to provide RAGFlow knowledge base configuration',
    needDifyConfig: 'Need to provide Dify knowledge base configuration',
    needAtLeastOneRagflowConfig:
      'Need to provide at least one RAGFlow knowledge base configuration',
    needAtLeastOneDifyConfig: 'Need to provide at least one Dify knowledge base configuration',
    needRagflowApiKey: 'Need to provide RAGFlow API Key',
    needDifyApiKey: 'Need to provide Dify API Key',
    needRagflowDatasetIds: 'Need to provide at least one RAGFlow Dataset ID',
    needDifyDatasetId: 'Need to provide Dify Dataset ID',
    needRagflowEndpoint: 'Need to provide RAGFlow Endpoint',
    needDifyEndpoint: 'Need to provide Dify Endpoint',
    needKnowledgeBaseDescription:
      'Need to provide a description for this knowledge base to help AI decide whether to retrieve this knowledge base'
  },
  ja: {
    mcpConnectionErrorTitle: 'MCP 接続エラー',
    mcpConnectionErrorMessage: 'MCP サーバーへの接続に失敗しました',
    addMcpServerErrorTitle: 'サーバーの追加に失敗しました',
    addMcpServerDuplicateMessage:
      'サーバー名「{serverName}」はすでに存在します。別の名前を選択してください。',
    getMcpToolListErrorTitle: 'ツール定義の取得に失敗しました',
    getMcpToolListErrorMessage:
      "サーバー '{serverName}' からツールリストを取得できません: {errorMessage}",
    genericErrorTitle: 'エラー',
    genericErrorMessage: 'エラーが発生しました',
    needRagflowConfig: 'RAGFlowの知識ベースの設定を提供する必要があります',
    needDifyConfig: 'Difyの知識ベースの設定を提供する必要があります',
    needAtLeastOneRagflowConfig: '少なくとも1つのRAGFlowの知識ベースの設定を提供する必要があります',
    needAtLeastOneDifyConfig: '少なくとも1つのDifyの知識ベースの設定を提供する必要があります',
    needRagflowApiKey: 'RAGFlowのAPIキーを提供する必要があります',
    needDifyApiKey: 'DifyのAPIキーを提供する必要があります',
    needRagflowDatasetIds: '少なくとも1つのRAGFlowのデータセットIDを提供する必要があります',
    needDifyDatasetId: 'DifyのデータセットIDを提供する必要があります',
    needRagflowEndpoint: 'RAGFlowのエンドポイントを提供する必要があります',
    needDifyEndpoint: 'Difyのエンドポイントを提供する必要があります',
    needKnowledgeBaseDescription:
      'この知識ベースの説明を提供する必要があります。AIがこの知識ベースを取得するかどうかを判断するのに役立ちます'
  },
  ko: {
    mcpConnectionErrorTitle: 'MCP 연결 오류',
    mcpConnectionErrorMessage: 'MCP 서버에 연결하지 못했습니다',
    addMcpServerErrorTitle: '서버 추가 실패',
    addMcpServerDuplicateMessage:
      '서버 이름 "{serverName}"이(가) 이미 존재합니다. 다른 이름을 선택하십시오.',
    getMcpToolListErrorTitle: '도구 정의 가져오기 실패',
    getMcpToolListErrorMessage:
      "서버 '{serverName}'에서 도구 목록을 검색할 수 없습니다: {errorMessage}",
    genericErrorTitle: '오류',
    genericErrorMessage: '오류가 발생했습니다',
    needRagflowConfig: 'RAGFlow 지식 베이스 구성을 제공해야 합니다',
    needDifyConfig: 'Dify 지식 베이스 구성을 제공해야 합니다',
    needAtLeastOneRagflowConfig: '최소 하나의 RAGFlow 지식 베이스 구성을 제공해야 합니다',
    needAtLeastOneDifyConfig: '최소 하나의 Dify 지식 베이스 구성을 제공해야 합니다',
    needRagflowApiKey: 'RAGFlow API 키를 제공해야 합니다',
    needDifyApiKey: 'Dify API 키를 제공해야 합니다',
    needRagflowDatasetIds: '최소 하나의 RAGFlow 데이터셋 ID를 제공해야 합니다',
    needDifyDatasetId: 'Dify 데이터셋 ID를 제공해야 합니다',
    needRagflowEndpoint: 'RAGFlow 엔드포인트를 제공해야 합니다',
    needDifyEndpoint: 'Dify 엔드포인트를 제공해야 합니다',
    needKnowledgeBaseDescription:
      'AI가 이 지식 베이스를 검색할지 여부를 결정하는 데 도움이 되는 설명을 제공해야 합니다'
  },
  fr: {
    mcpConnectionErrorTitle: 'Erreur de connexion MCP',
    mcpConnectionErrorMessage: 'Échec de la connexion au serveur MCP',
    addMcpServerErrorTitle: "L'ajout du serveur a échoué",
    addMcpServerDuplicateMessage:
      'Le nom du serveur "{serverName}" existe déjà. Veuillez choisir un nom différent.',
    getMcpToolListErrorTitle: "Échec de la récupération des définitions d'outils",
    getMcpToolListErrorMessage:
      "Impossible de récupérer la liste d'outils du serveur '{serverName}': {errorMessage}",
    genericErrorTitle: 'Erreur',
    genericErrorMessage: "Une erreur s'est produite",
    needRagflowConfig: 'Vous devez fournir la configuration de la base de connaissances RAGFlow',
    needDifyConfig: 'Vous devez fournir la configuration de la base de connaissances Dify',
    needAtLeastOneRagflowConfig:
      'Vous devez fournir au moins une configuration de base de connaissances RAGFlow',
    needAtLeastOneDifyConfig:
      'Vous devez fournir au moins une configuration de base de connaissances Dify',
    needRagflowApiKey: 'Vous devez fournir la clé API RAGFlow',
    needDifyApiKey: 'Vous devez fournir la clé API Dify',
    needRagflowDatasetIds: 'Vous devez fournir au moins un identifiant de jeu de données RAGFlow',
    needDifyDatasetId: "Vous devez fournir l'identifiant de jeu de données Dify",
    needRagflowEndpoint: 'Vous devez fournir le point de terminaison RAGFlow',
    needDifyEndpoint: 'Vous devez fournir le point de terminaison Dify',
    needKnowledgeBaseDescription:
      "Vous devez fournir une description de cette base de connaissances pour aider l'IA à décider si elle doit récupérer cette base de connaissances"
  },
  de: {
    mcpConnectionErrorTitle: 'MCP-Verbindungsfehler',
    mcpConnectionErrorMessage: 'Verbindung zum MCP-Server fehlgeschlagen',
    addMcpServerErrorTitle: 'Server hinzufügen fehlgeschlagen',
    addMcpServerDuplicateMessage:
      'Servername "{serverName}" existiert bereits. Bitte wählen Sie einen anderen Namen.',
    getMcpToolListErrorTitle: 'Tooldefinitionen konnten nicht abgerufen werden',
    getMcpToolListErrorMessage:
      "Die Toolliste konnte nicht vom Server '{serverName}' abgerufen werden: {errorMessage}",
    genericErrorTitle: 'Fehler',
    genericErrorMessage: 'Ein Fehler ist aufgetreten',
    needRagflowConfig: 'RAGFlow-Konfigurationsdaten müssen bereitgestellt werden',
    needDifyConfig: 'Dify-Konfigurationsdaten müssen bereitgestellt werden',
    needAtLeastOneRagflowConfig:
      'Es muss mindestens eine RAGFlow-Konfiguration bereitgestellt werden',
    needAtLeastOneDifyConfig: 'Es muss mindestens eine Dify-Konfiguration bereitgestellt werden',
    needRagflowApiKey: 'Es muss ein RAGFlow-API-Schlüssel bereitgestellt werden',
    needDifyApiKey: 'Es muss ein Dify-API-Schlüssel bereitgestellt werden',
    needRagflowDatasetIds: 'Es muss mindestens eine RAGFlow-Dataset-ID bereitgestellt werden',
    needDifyDatasetId: 'Es muss eine Dify-Dataset-ID bereitgestellt werden',
    needRagflowEndpoint: 'Es muss ein RAGFlow-Endpunkt bereitgestellt werden',
    needDifyEndpoint: 'Es muss ein Dify-Endpunkt bereitgestellt werden',
    needKnowledgeBaseDescription:
      'Es muss eine Beschreibung dieser Wissensdatenbank bereitgestellt werden, um der KI zu helfen, zu entscheiden, ob sie diese Wissensdatenbank abrufen soll'
  },
  es: {
    mcpConnectionErrorTitle: 'Error de conexión MCP',
    mcpConnectionErrorMessage: 'Error al conectar con el servidor MCP',
    addMcpServerErrorTitle: 'Error al agregar el servidor',
    addMcpServerDuplicateMessage:
      'El nombre del servidor "{serverName}" ya existe. Por favor, elija un nombre diferente.',
    getMcpToolListErrorTitle: 'Error al obtener las definiciones de herramientas',
    getMcpToolListErrorMessage:
      "No se puede recuperar la lista de herramientas del servidor '{serverName}': {errorMessage}",
    genericErrorTitle: 'Error',
    genericErrorMessage: 'Se ha producido un error',
    needRagflowConfig: 'Se deben proporcionar los datos de configuración de RAGFlow',
    needDifyConfig: 'Se deben proporcionar los datos de configuración de Dify',
    needAtLeastOneRagflowConfig: 'Se debe proporcionar al menos una configuración de RAGFlow',
    needAtLeastOneDifyConfig: 'Se debe proporcionar al menos una configuración de Dify',
    needRagflowApiKey: 'Se debe proporcionar la clave API de RAGFlow',
    needDifyApiKey: 'Se debe proporcionar la clave API de Dify',
    needRagflowDatasetIds:
      'Se debe proporcionar al menos un identificador de conjunto de datos de RAGFlow',
    needDifyDatasetId: 'Se debe proporcionar el identificador de conjunto de datos de Dify',
    needRagflowEndpoint: 'Se debe proporcionar el punto de acceso de RAGFlow',
    needDifyEndpoint: 'Se debe proporcionar el punto de acceso de Dify',
    needKnowledgeBaseDescription:
      'Se debe proporcionar una descripción de esta base de conocimientos para ayudar a la IA a decidir si debe recuperar esta base de conocimientos'
  },
  'pt-BR': {
    mcpConnectionErrorTitle: 'Erro de Conexão MCP',
    mcpConnectionErrorMessage: 'Falha ao conectar ao servidor MCP',
    addMcpServerErrorTitle: 'Falha ao Adicionar Servidor',
    addMcpServerDuplicateMessage:
      'O nome do servidor "{serverName}" já existe. Por favor, escolha um nome diferente.',
    getMcpToolListErrorTitle: 'Falha ao Obter Definições de Ferramentas',
    getMcpToolListErrorMessage:
      "Não foi possível recuperar a lista de ferramentas do servidor '{serverName}': {errorMessage}",
    genericErrorTitle: 'Erro',
    genericErrorMessage: 'Ocorreu um erro',
    needRagflowConfig: 'É necessário fornecer a configuração da base de conhecimento RAGFlow',
    needDifyConfig: 'É necessário fornecer a configuração da base de conhecimento Dify',
    needAtLeastOneRagflowConfig:
      'É necessário fornecer pelo menos uma configuração da base de conhecimento RAGFlow',
    needAtLeastOneDifyConfig:
      'É necessário fornecer pelo menos uma configuração da base de conhecimento Dify',
    needRagflowApiKey: 'É necessário fornecer a chave API do RAGFlow',
    needDifyApiKey: 'É necessário fornecer a chave API do Dify',
    needRagflowDatasetIds: 'É necessário fornecer pelo menos um ID de conjunto de dados do RAGFlow',
    needDifyDatasetId: 'É necessário fornecer o ID do conjunto de dados do Dify',
    needRagflowEndpoint: 'É necessário fornecer o endpoint do RAGFlow',
    needDifyEndpoint: 'É necessário fornecer o endpoint do Dify',
    needKnowledgeBaseDescription:
      'É necessário fornecer uma descrição para esta base de conhecimento para ajudar a IA a decidir se deve recuperar esta base de conhecimento'
  }
}

Object.assign(errorMessageTranslations, {
  'es-ES': {
    mcpConnectionErrorTitle: 'Error de conexión MCP',
    mcpConnectionErrorMessage: 'No se pudo conectar al servidor MCP',
    addMcpServerErrorTitle: 'No se pudo añadir el servidor',
    addMcpServerDuplicateMessage:
      'El nombre de servidor "{serverName}" ya existe. Elige otro nombre.',
    getMcpToolListErrorTitle: 'No se pudieron obtener las definiciones de herramientas',
    getMcpToolListErrorMessage:
      "No se pudo recuperar la lista de herramientas del servidor '{serverName}': {errorMessage}",
    genericErrorTitle: 'Error',
    genericErrorMessage: 'Se ha producido un error',
    needRagflowConfig: 'Debes proporcionar la configuración de la base de conocimiento RAGFlow',
    needDifyConfig: 'Debes proporcionar la configuración de la base de conocimiento Dify',
    needAtLeastOneRagflowConfig:
      'Debes proporcionar al menos una configuración de base de conocimiento RAGFlow',
    needAtLeastOneDifyConfig:
      'Debes proporcionar al menos una configuración de base de conocimiento Dify',
    needRagflowApiKey: 'Debes proporcionar la API Key de RAGFlow',
    needDifyApiKey: 'Debes proporcionar la API Key de Dify',
    needRagflowDatasetIds: 'Debes proporcionar al menos un Dataset ID de RAGFlow',
    needDifyDatasetId: 'Debes proporcionar el Dataset ID de Dify',
    needRagflowEndpoint: 'Debes proporcionar el Endpoint de RAGFlow',
    needDifyEndpoint: 'Debes proporcionar el Endpoint de Dify',
    needKnowledgeBaseDescription:
      'Debes proporcionar una descripción de esta base de conocimiento para ayudar a la IA a decidir si debe consultarla'
  },
  'de-DE': {
    mcpConnectionErrorTitle: 'MCP-Verbindungsfehler',
    mcpConnectionErrorMessage: 'Verbindung zum MCP-Server fehlgeschlagen',
    addMcpServerErrorTitle: 'Server konnte nicht hinzugefügt werden',
    addMcpServerDuplicateMessage:
      'Der Servername "{serverName}" ist bereits vorhanden. Wählen Sie einen anderen Namen.',
    getMcpToolListErrorTitle: 'Tooldefinitionen konnten nicht abgerufen werden',
    getMcpToolListErrorMessage:
      "Die Toolliste konnte vom Server '{serverName}' nicht abgerufen werden: {errorMessage}",
    genericErrorTitle: 'Fehler',
    genericErrorMessage: 'Es ist ein Fehler aufgetreten',
    needRagflowConfig: 'Die Konfiguration der RAGFlow-Wissensdatenbank muss angegeben werden',
    needDifyConfig: 'Die Konfiguration der Dify-Wissensdatenbank muss angegeben werden',
    needAtLeastOneRagflowConfig:
      'Mindestens eine Konfiguration der RAGFlow-Wissensdatenbank muss angegeben werden',
    needAtLeastOneDifyConfig:
      'Mindestens eine Konfiguration der Dify-Wissensdatenbank muss angegeben werden',
    needRagflowApiKey: 'Die API Key für RAGFlow muss angegeben werden',
    needDifyApiKey: 'Die API Key für Dify muss angegeben werden',
    needRagflowDatasetIds: 'Mindestens eine RAGFlow Dataset ID muss angegeben werden',
    needDifyDatasetId: 'Die Dify Dataset ID muss angegeben werden',
    needRagflowEndpoint: 'Der RAGFlow Endpoint muss angegeben werden',
    needDifyEndpoint: 'Der Dify Endpoint muss angegeben werden',
    needKnowledgeBaseDescription:
      'Für diese Wissensdatenbank muss eine Beschreibung angegeben werden, damit die KI entscheiden kann, ob sie sie abrufen soll'
  },
  'tr-TR': {
    mcpConnectionErrorTitle: 'MCP bağlantı hatası',
    mcpConnectionErrorMessage: 'MCP sunucusuna bağlanılamadı',
    addMcpServerErrorTitle: 'Sunucu eklenemedi',
    addMcpServerDuplicateMessage:
      '"{serverName}" sunucu adı zaten var. Lütfen farklı bir ad seçin.',
    getMcpToolListErrorTitle: 'Araç tanımları alınamadı',
    getMcpToolListErrorMessage:
      "'{serverName}' sunucusundan araç listesi alınamadı: {errorMessage}",
    genericErrorTitle: 'Hata',
    genericErrorMessage: 'Bir hata oluştu',
    needRagflowConfig: 'RAGFlow bilgi tabanı yapılandırması sağlanmalıdır',
    needDifyConfig: 'Dify bilgi tabanı yapılandırması sağlanmalıdır',
    needAtLeastOneRagflowConfig: 'En az bir RAGFlow bilgi tabanı yapılandırması sağlanmalıdır',
    needAtLeastOneDifyConfig: 'En az bir Dify bilgi tabanı yapılandırması sağlanmalıdır',
    needRagflowApiKey: 'RAGFlow API Key sağlanmalıdır',
    needDifyApiKey: 'Dify API Key sağlanmalıdır',
    needRagflowDatasetIds: 'En az bir RAGFlow Dataset ID sağlanmalıdır',
    needDifyDatasetId: 'Dify Dataset ID sağlanmalıdır',
    needRagflowEndpoint: 'RAGFlow Endpoint sağlanmalıdır',
    needDifyEndpoint: 'Dify Endpoint sağlanmalıdır',
    needKnowledgeBaseDescription:
      "AI'ın bu bilgi tabanını getirip getirmeyeceğine karar verebilmesi için bir açıklama sağlanmalıdır"
  },
  'id-ID': {
    mcpConnectionErrorTitle: 'Kesalahan koneksi MCP',
    mcpConnectionErrorMessage: 'Gagal terhubung ke server MCP',
    addMcpServerErrorTitle: 'Gagal menambahkan server',
    addMcpServerDuplicateMessage: 'Nama server "{serverName}" sudah ada. Pilih nama lain.',
    getMcpToolListErrorTitle: 'Gagal mendapatkan definisi alat',
    getMcpToolListErrorMessage:
      "Tidak dapat mengambil daftar alat dari server '{serverName}': {errorMessage}",
    genericErrorTitle: 'Kesalahan',
    genericErrorMessage: 'Terjadi kesalahan',
    needRagflowConfig: 'Konfigurasi basis pengetahuan RAGFlow perlu disediakan',
    needDifyConfig: 'Konfigurasi basis pengetahuan Dify perlu disediakan',
    needAtLeastOneRagflowConfig:
      'Setidaknya satu konfigurasi basis pengetahuan RAGFlow perlu disediakan',
    needAtLeastOneDifyConfig: 'Setidaknya satu konfigurasi basis pengetahuan Dify perlu disediakan',
    needRagflowApiKey: 'API Key RAGFlow perlu disediakan',
    needDifyApiKey: 'API Key Dify perlu disediakan',
    needRagflowDatasetIds: 'Setidaknya satu Dataset ID RAGFlow perlu disediakan',
    needDifyDatasetId: 'Dataset ID Dify perlu disediakan',
    needRagflowEndpoint: 'Endpoint RAGFlow perlu disediakan',
    needDifyEndpoint: 'Endpoint Dify perlu disediakan',
    needKnowledgeBaseDescription:
      'Deskripsi basis pengetahuan ini perlu disediakan agar AI dapat memutuskan apakah perlu mengambilnya'
  },
  'ms-MY': {
    mcpConnectionErrorTitle: 'Ralat sambungan MCP',
    mcpConnectionErrorMessage: 'Gagal menyambung ke pelayan MCP',
    addMcpServerErrorTitle: 'Gagal menambah pelayan',
    addMcpServerDuplicateMessage: 'Nama pelayan "{serverName}" sudah wujud. Sila pilih nama lain.',
    getMcpToolListErrorTitle: 'Gagal mendapatkan definisi alat',
    getMcpToolListErrorMessage:
      "Tidak dapat mendapatkan senarai alat daripada pelayan '{serverName}': {errorMessage}",
    genericErrorTitle: 'Ralat',
    genericErrorMessage: 'Ralat telah berlaku',
    needRagflowConfig: 'Konfigurasi pangkalan pengetahuan RAGFlow perlu diberikan',
    needDifyConfig: 'Konfigurasi pangkalan pengetahuan Dify perlu diberikan',
    needAtLeastOneRagflowConfig:
      'Sekurang-kurangnya satu konfigurasi pangkalan pengetahuan RAGFlow perlu diberikan',
    needAtLeastOneDifyConfig:
      'Sekurang-kurangnya satu konfigurasi pangkalan pengetahuan Dify perlu diberikan',
    needRagflowApiKey: 'API Key RAGFlow perlu diberikan',
    needDifyApiKey: 'API Key Dify perlu diberikan',
    needRagflowDatasetIds: 'Sekurang-kurangnya satu Dataset ID RAGFlow perlu diberikan',
    needDifyDatasetId: 'Dataset ID Dify perlu diberikan',
    needRagflowEndpoint: 'Endpoint RAGFlow perlu diberikan',
    needDifyEndpoint: 'Endpoint Dify perlu diberikan',
    needKnowledgeBaseDescription:
      'Penerangan untuk pangkalan pengetahuan ini perlu diberikan supaya AI boleh memutuskan sama ada perlu mendapatkannya'
  },
  'it-IT': {
    mcpConnectionErrorTitle: 'Errore di connessione MCP',
    mcpConnectionErrorMessage: 'Connessione al server MCP non riuscita',
    addMcpServerErrorTitle: 'Impossibile aggiungere il server',
    addMcpServerDuplicateMessage: 'Il nome server "{serverName}" esiste già. Scegli un altro nome.',
    getMcpToolListErrorTitle: 'Impossibile ottenere le definizioni degli strumenti',
    getMcpToolListErrorMessage:
      "Impossibile recuperare l'elenco degli strumenti dal server '{serverName}': {errorMessage}",
    genericErrorTitle: 'Errore',
    genericErrorMessage: 'Si è verificato un errore',
    needRagflowConfig: 'Devi fornire la configurazione della base di conoscenza RAGFlow',
    needDifyConfig: 'Devi fornire la configurazione della base di conoscenza Dify',
    needAtLeastOneRagflowConfig:
      'Devi fornire almeno una configurazione della base di conoscenza RAGFlow',
    needAtLeastOneDifyConfig:
      'Devi fornire almeno una configurazione della base di conoscenza Dify',
    needRagflowApiKey: 'Devi fornire la API Key di RAGFlow',
    needDifyApiKey: 'Devi fornire la API Key di Dify',
    needRagflowDatasetIds: 'Devi fornire almeno un Dataset ID di RAGFlow',
    needDifyDatasetId: 'Devi fornire il Dataset ID di Dify',
    needRagflowEndpoint: 'Devi fornire l’Endpoint di RAGFlow',
    needDifyEndpoint: 'Devi fornire l’Endpoint di Dify',
    needKnowledgeBaseDescription:
      'Devi fornire una descrizione di questa base di conoscenza per aiutare l’AI a decidere se recuperarla'
  },
  'pl-PL': {
    mcpConnectionErrorTitle: 'Błąd połączenia MCP',
    mcpConnectionErrorMessage: 'Nie udało się połączyć z serwerem MCP',
    addMcpServerErrorTitle: 'Nie udało się dodać serwera',
    addMcpServerDuplicateMessage: 'Nazwa serwera "{serverName}" już istnieje. Wybierz inną nazwę.',
    getMcpToolListErrorTitle: 'Nie udało się pobrać definicji narzędzi',
    getMcpToolListErrorMessage:
      "Nie można pobrać listy narzędzi z serwera '{serverName}': {errorMessage}",
    genericErrorTitle: 'Błąd',
    genericErrorMessage: 'Wystąpił błąd',
    needRagflowConfig: 'Wymagana jest konfiguracja bazy wiedzy RAGFlow',
    needDifyConfig: 'Wymagana jest konfiguracja bazy wiedzy Dify',
    needAtLeastOneRagflowConfig: 'Wymagana jest co najmniej jedna konfiguracja bazy wiedzy RAGFlow',
    needAtLeastOneDifyConfig: 'Wymagana jest co najmniej jedna konfiguracja bazy wiedzy Dify',
    needRagflowApiKey: 'Wymagana jest API Key RAGFlow',
    needDifyApiKey: 'Wymagana jest API Key Dify',
    needRagflowDatasetIds: 'Wymagany jest co najmniej jeden Dataset ID RAGFlow',
    needDifyDatasetId: 'Wymagany jest Dataset ID Dify',
    needRagflowEndpoint: 'Wymagany jest Endpoint RAGFlow',
    needDifyEndpoint: 'Wymagany jest Endpoint Dify',
    needKnowledgeBaseDescription:
      'Wymagany jest opis tej bazy wiedzy, aby AI mogła zdecydować, czy ją pobrać'
  },
  'vi-VN': {
    mcpConnectionErrorTitle: 'Lỗi kết nối MCP',
    mcpConnectionErrorMessage: 'Không thể kết nối tới máy chủ MCP',
    addMcpServerErrorTitle: 'Không thể thêm máy chủ',
    addMcpServerDuplicateMessage: 'Tên máy chủ "{serverName}" đã tồn tại. Vui lòng chọn tên khác.',
    getMcpToolListErrorTitle: 'Không thể lấy định nghĩa công cụ',
    getMcpToolListErrorMessage:
      "Không thể lấy danh sách công cụ từ máy chủ '{serverName}': {errorMessage}",
    genericErrorTitle: 'Lỗi',
    genericErrorMessage: 'Đã xảy ra lỗi',
    needRagflowConfig: 'Cần cung cấp cấu hình cơ sở kiến thức RAGFlow',
    needDifyConfig: 'Cần cung cấp cấu hình cơ sở kiến thức Dify',
    needAtLeastOneRagflowConfig: 'Cần cung cấp ít nhất một cấu hình cơ sở kiến thức RAGFlow',
    needAtLeastOneDifyConfig: 'Cần cung cấp ít nhất một cấu hình cơ sở kiến thức Dify',
    needRagflowApiKey: 'Cần cung cấp API Key RAGFlow',
    needDifyApiKey: 'Cần cung cấp API Key Dify',
    needRagflowDatasetIds: 'Cần cung cấp ít nhất một Dataset ID RAGFlow',
    needDifyDatasetId: 'Cần cung cấp Dataset ID Dify',
    needRagflowEndpoint: 'Cần cung cấp Endpoint RAGFlow',
    needDifyEndpoint: 'Cần cung cấp Endpoint Dify',
    needKnowledgeBaseDescription:
      'Cần cung cấp mô tả cho cơ sở kiến thức này để AI quyết định có cần truy xuất hay không'
  }
})

/**
 * Get the best matching translation based on language code
 * @param locale Language code
 * @param translations Translation mapping table
 * @returns Matching translation object
 */
export function getBestMatchTranslation(
  locale: string,
  translations: Record<string, TranslationMap>
): TranslationMap {
  // Default to English
  let targetLocale = 'en-US'

  // Find the best matching language
  for (const supported of supportedLocales) {
    if (
      locale.startsWith(supported) ||
      (supported.includes('-') && locale.startsWith(supported.split('-')[0]))
    ) {
      targetLocale = supported
      break
    }
  }

  return translations[targetLocale] || translations['en-US']
}

/**
 * Get context menu translations
 * @param locale Language code
 * @returns Context menu translations
 */
export function getContextMenuLabels(locale: string): TranslationMap {
  return getBestMatchTranslation(locale, contextMenuTranslations)
}

/**
 * Get error message translations
 * @param locale Language code
 * @returns Error message translations
 */
export function getErrorMessageLabels(locale: string): TranslationMap {
  return getBestMatchTranslation(locale, errorMessageTranslations)
}
