import common from './common.json'
import mcp from './mcp.json'
import settings from './settings.json'
import about from './about.json'
import sync from './sync.json'
import thread from './thread.json'
import toolCall from './toolCall.json'
import update from './update.json'
import welcome from './welcome.json'
import components from './components.json'
import dialog from './dialog.json'
import model from './model.json'
import newThread from './newThread.json'
import routes from './routes.json'
import artifacts from './artifacts.json'
import chat from './chat.json'
import contextMenu from './contextMenu.json'
import promptSetting from './promptSetting.json'

// 单独的顶层键
const others = {
  Silicon: ' SiliconFlow',
  Qiniu: 'Qiniu',
  QwenLM: 'Qwen Model',
  Doubao: 'Doubao',
  PPIO: 'PPIO Cloud',
  Moonshot: 'Moonshot AI',
  DashScope: 'Alibaba Bailian',
  Hunyuan: 'Hunyuan',
  searchDisclaimer:
    "DeepChat est uniquement un outil d'assistance qui organise et résume les données publiques retournées par les moteurs de recherche lorsque les utilisateurs initient activement des recherches, aidant les utilisateurs à visualiser et comprendre plus facilement les résultats de recherche.\n1. Utilisation des données publiques\nCe logiciel ne traite que les données accessibles publiquement sur les sites cibles ou les moteurs de recherche sans nécessiter de connexion. Avant utilisation, veuillez consulter et respecter les conditions d'utilisation du site ou du moteur de recherche cible pour garantir la légalité de votre utilisation.\n2. Exactitude et responsabilité des informations\nLe contenu organisé et généré par ce logiciel est fourni à titre de référence uniquement et ne constitue en aucun cas un conseil juridique, commercial ou autre. Les développeurs ne garantissent pas l'exactitude, l'exhaustivité, l'actualité ou la légalité des résultats de recherche, et toute conséquence découlant de l'utilisation de ce logiciel relève de la seule responsabilité de l'utilisateur.\n3. Clause de non-responsabilité\nCe logiciel est fourni \"en l'état\", et les développeurs n'assument aucune garantie expresse ou implicite quant à ses performances, sa stabilité ou son applicabilité. Lors de l'utilisation de ce logiciel, les développeurs n'assument aucune responsabilité pour tout litige, perte ou responsabilité légale résultant de violations des lois et règlements applicables ou des règles du site cible.\n4. Autodiscipline de l'utilisateur\nAvant d'utiliser ce logiciel, les utilisateurs doivent pleinement comprendre et confirmer que leur utilisation ne porte pas atteinte aux droits de propriété intellectuelle, aux secrets commerciaux ou à d'autres droits légitimes d'autrui. Tout litige ou conséquence juridique résultant d'une utilisation inappropriée de ce logiciel par les utilisateurs relève de leur seule responsabilité.\nL'utilisation de ce logiciel indique que l'utilisateur a lu, compris et accepté toutes les conditions de cette clause de non-responsabilité. En cas de doute, veuillez consulter un conseiller juridique professionnel."
}

export default {
  common,
  mcp,
  settings,
  about,
  sync,
  thread,
  toolCall,
  update,
  welcome,
  components,
  dialog,
  model,
  newThread,
  routes,
  artifacts,
  chat,
  contextMenu,
  promptSetting,
  ...others
}
