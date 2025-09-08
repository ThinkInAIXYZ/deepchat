// Translation key-value type interface
export interface TranslationMap {
  [key: string]: string
}

// Define supported languages
export const supportedLocales = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'de', 'es']

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
    askAI: '询问AI'
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
    askAI: '詢問AI'
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
    askAI: 'Ask AI'
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
    askAI: 'AIに質問'
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
    askAI: 'AI에게 질문'
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
    askAI: "Demander à l'AI"
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
    askAI: 'KI fragen'
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
    askAI: 'Preguntar a la AI'
  }
}

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
  }
}

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
