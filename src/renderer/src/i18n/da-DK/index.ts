import common from './common.json'
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
import newThread from './newThread.json'
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
  Doubao: 'Doubao',
  PPIO: 'PPIO Cloud',
  Moonshot: 'Moonshot AI',
  DashScope: 'Alibaba Bailian',
  Hunyuan: 'Hunyuan',
  searchDisclaimer:
    'DeepChat er kun et hjælpemiddel, der organiserer og opsummerer offentlige data fra søgemaskiner, når brugeren aktivt søger, så resultaterne er lettere at læse og forstå.\n1. Brug af offentlige data\nSoftwaren behandler kun data, der er offentligt tilgængelige på målwebsteder eller søgemaskiner uden login. Læs og efterlev altid vilkårene for målwebstedet eller søgemaskinen for at sikre lovlig brug.\n2. Informationsnøjagtighed og ansvar\nIndholdet, der organiseres og genereres af softwaren, er kun til reference og udgør ikke juridiske, forretningsmæssige eller andre råd. Udviklerne garanterer ikke nøjagtighed, fuldstændighed, aktualitet eller lovlighed, og alle konsekvenser bæres af brugeren.\n3. Ansvarsfraskrivelse\nSoftwaren leveres "som den er", og udviklerne påtager sig ingen udtrykkelig eller underforstået garanti for ydeevne, stabilitet eller anvendelighed. Under brugen er udviklerne ikke ansvarlige for tvister, tab eller juridisk ansvar, der opstår ved overtrædelse af de gældende love eller målwebstedets regler.\n4. Brugernes ansvar\nInden du bruger softwaren, skal du sikre, at din brug ikke krænker andres immaterielle rettigheder, forretningshemmeligheder eller andre lovlige rettigheder. Alle tvister og konsekvenser, der opstår ved forkert brug af softwaren, bæres udelukkende af brugeren.\nBrug af softwaren betyder, at du har læst, forstået og accepteret alle vilkår i denne ansvarsfraskrivelse. Kontakt en professionel juridisk rådgiver, hvis du er i tvivl.'
}

export default {
  common,
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
  newThread,
  about,
  contextMenu,
  promptSetting,
  traceDialog,
  plan,
  ...others
}
