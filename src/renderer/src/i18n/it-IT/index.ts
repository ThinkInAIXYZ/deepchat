import common from './common.json'
import image from './image.json'
import update from './update.json'
import routes from './routes.json'
import chat from './chat.json'
import model from './model.json'
import thread from './thread.json'
import dialog from './dialog.json'
import settings from './settings.json'
import mcp from './mcp.json'
import welcome from './welcome.json'
import artifacts from './artifacts.json'
import sync from './sync.json'
import toolCall from './toolCall.json'
import components from './components.json'
import about from './about.json'
import contextMenu from './contextMenu.json'
import promptSetting from './promptSetting.json'
import traceDialog from './traceDialog.json'
import plan from './plan.json'

// Chiavi top-level separate
const others = {
  Silicon: 'SiliconFlow',
  Qiniu: 'Qiniu',
  QwenLM: 'Qwen Model',
  Doubao: 'Volcano Engine',
  PPIO: 'PPIO Cloud',
  Moonshot: 'Moonshot AI',
  Hunyuan: 'Hunyuan',
  DashScope: 'Alibaba Bailian',
  Zhipu: 'Zhipu',
  searchDisclaimer:
    "DeepChat è solo uno strumento di supporto: quando l'utente avvia attivamente una ricerca, organizza e riassume i dati pubblici restituiti dai motori di ricerca, aiutando l'utente a consultare e comprendere più comodamente i risultati.\n\n1. **Uso di dati pubblici**  \nQuesto software tratta solo dati pubblicamente disponibili su siti target o motori di ricerca e accessibili senza login. Prima dell'uso, consulta e rispetta i termini di servizio del sito target o del motore di ricerca, assicurandoti che l'uso sia legale e conforme.  \n\n2. **Accuratezza delle informazioni e responsabilità**  \nI contenuti organizzati e generati da questo software sono solo a scopo di riferimento e non costituiscono alcun tipo di consulenza legale, commerciale o di altro genere. Gli sviluppatori non garantiscono accuratezza, completezza, tempestività o legalità dei risultati di ricerca; qualsiasi conseguenza derivante dall'uso del software resta a carico dell'utente.  \n\n3. **Clausola di esclusione di responsabilità**  \nQuesto software è fornito \"così com'è\"; gli sviluppatori non assumono garanzie o responsabilità espresse o implicite su prestazioni, stabilità o idoneità. Se durante l'uso del software sorgono controversie, perdite o responsabilità legali causate dalla violazione di leggi, regolamenti o regole del sito target, gli sviluppatori non assumono alcuna responsabilità.  \n\n4. **Autodisciplina dell'utente**  \nPrima di usare questo software, l'utente deve comprendere e confermare che il proprio uso non violi diritti di proprietà intellettuale, segreti commerciali o altri diritti legittimi di terzi. Qualsiasi controversia legale o conseguenza causata da un uso improprio del software da parte dell'utente resta esclusivamente a carico dell'utente.  \n\nL'uso di questo software indica che l'utente ha letto, compreso e accettato tutti i termini di questo disclaimer. In caso di dubbi, consulta un consulente legale professionista."
}

export default {
  common,
  image,
  update,
  routes,
  chat,
  model,
  thread,
  dialog,
  settings,
  mcp,
  welcome,
  artifacts,
  sync,
  toolCall,
  components,
  about,
  contextMenu,
  promptSetting,
  traceDialog,
  plan,
  ...others
}
