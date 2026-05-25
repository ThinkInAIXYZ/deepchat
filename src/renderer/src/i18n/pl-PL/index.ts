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

// Individual top-level keys
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
    'DeepChat to jedynie narzędzie pomocnicze, które porządkuje i podsumowuje publiczne dane zwracane przez wyszukiwarki, gdy użytkownicy aktywnie inicjują wyszukiwania, pomagając użytkownikom wygodniej przeglądać i rozumieć wyniki wyszukiwania.\\n1. Korzystanie z danych publicznych\\nTo oprogramowanie przetwarza wyłącznie dane, które są publicznie dostępne w docelowych witrynach internetowych lub wyszukiwarkach i nie wymagają logowania. Przed użyciem zapoznaj się z warunkami korzystania z usługi docelowej witryny lub wyszukiwarki i przestrzegaj ich, aby upewnić się, że korzystanie z nich jest legalne i zgodne.\\n2. Dokładność informacji i odpowiedzialność\\nTreść uporządkowana i wygenerowana przez to oprogramowanie ma wyłącznie charakter informacyjny i nie stanowi żadnej formy porady prawnej, biznesowej ani innej. Twórcy nie udzielają żadnych gwarancji dotyczących dokładności, kompletności, aktualności lub legalności wyników wyszukiwania, a wszelkie konsekwencje wynikające z korzystania z tego oprogramowania obciążają wyłącznie użytkownika.\\n3. Klauzula wyłączenia odpowiedzialności\\nTo oprogramowanie jest dostarczane „tak jak jest”, a programiści nie przyjmują żadnej wyraźnej ani dorozumianej gwarancji ani odpowiedzialności za jego działanie, stabilność lub możliwość zastosowania. W procesie korzystania z tego oprogramowania programiści nie ponoszą żadnej odpowiedzialności za jakiekolwiek spory, straty lub zobowiązania prawne wynikające z naruszeń odpowiednich przepisów ustawowych i wykonawczych lub zasad witryny docelowej.\\n4. Samodyscyplina użytkownika\\nPrzed użyciem tego oprogramowania użytkownicy powinni w pełni zrozumieć i potwierdzić, że ich użycie nie naruszy praw własności intelektualnej, tajemnic handlowych ani innych uzasadnionych praw innych osób. Wszelkie spory prawne i konsekwencje wynikające z niewłaściwego korzystania z tego oprogramowania przez użytkowników stanowią wyłączną odpowiedzialność użytkowników.\\nKorzystanie z tego oprogramowania oznacza, że ​​użytkownik przeczytał, zrozumiał i zgodził się na wszystkie warunki niniejszego zastrzeżenia. W przypadku pytań prosimy o konsultację z profesjonalnym doradcą prawnym.'
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
