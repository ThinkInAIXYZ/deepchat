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
import tapeInspector from './tapeInspector.json'
import plan from './plan.json'

const others = {
  Silicon: 'SiliconFlow',
  Qiniu: 'Qiniu',
  QwenLM: 'Qwen مودېلى',
  Doubao: 'Volcano Engine',
  PPIO: 'PPIO Cloud',
  Moonshot: 'Moonshot AI',
  DashScope: 'Alibaba Bailian',
  Hunyuan: 'Hunyuan',
  Zhipu: 'Zhipu',
  searchDisclaimer:
    'DeepChat ئىشلەتكۈچىلەر ئۆزلۈكىدىن ئىزدەشنى باشلىغاندا، ئىزدەش ماتورلىرى قايتۇرغان ئاشكارا سانلىق مەلۇماتلارنى رەتلەپ خۇلاسىلەيدىغان ياردەمچى قورال بولۇپ، ئىزدەش نەتىجىلىرىنى تېخىمۇ قولايلىق كۆرۈش ۋە چۈشىنىشكە ياردەم بېرىدۇ.\n\n1. **ئاشكارا سانلىق مەلۇماتنى ئىشلىتىش**\nبۇ يۇمشاق دېتال پەقەت نىشان تور بېكەت ياكى ئىزدەش ماتورىدا ئاشكارا بولغان، تىزىملىتىپ كىرمەي زىيارەت قىلغىلى بولىدىغان سانلىق مەلۇماتلارنى بىر تەرەپ قىلىدۇ. ئىشلىتىشتىن بۇرۇن نىشان تور بېكەت ياكى ئىزدەش ماتورىنىڭ مۇلازىمەت شەرتلىرىنى ئوقۇپ رىئايە قىلىڭ، ئىشلىتىش ھەرىكىتىڭىزنىڭ قانۇن ۋە قائىدىلەرگە ئۇيغۇن بولۇشىغا كاپالەتلىك قىلىڭ.\n\n2. **ئۇچۇرنىڭ توغرىلىقى ۋە جاۋابكارلىق**\nبۇ يۇمشاق دېتال رەتلىگەن ۋە ھاسىل قىلغان مەزمۇن پەقەت پايدىلىنىش ئۈچۈن بولۇپ، ھېچقانداق شەكىلدىكى قانۇن، سودا ياكى باشقا مەسلىھەتنى تەشكىل قىلمايدۇ. ئاچقۇچىلار ئىزدەش نەتىجىلىرىنىڭ توغرىلىقى، تولۇقلىقى، ۋاقتىدا بولۇشى ياكى قانۇنلۇقلىقىغا كاپالەت بەرمەيدۇ. بۇ يۇمشاق دېتالنى ئىشلىتىشتىن كېلىپ چىققان ئاقىۋەتلەرنى ئىشلەتكۈچى ئۆزى ئۈستىگە ئالىدۇ.\n\n3. **جاۋابكارلىقتىن كەچۈرۈم ماددىسى**\nبۇ يۇمشاق دېتال «ھازىرقى ھالىتىدە» تەمىنلىنىدۇ. ئاچقۇچىلار ئۇنىڭ ئىقتىدارى، مۇقىملىقى ۋە ماسلىشىشچانلىقىغا ئائىت ھېچقانداق ئېنىق ياكى يوشۇرۇن كاپالەت ياكى جاۋابكارلىقنى ئۈستىگە ئالمايدۇ. بۇ يۇمشاق دېتالنى ئىشلىتىش جەريانىدا ئالاقىدار قانۇن-نىزام ياكى نىشان تور بېكەتنىڭ قائىدىلىرىگە خىلاپلىق قىلىش سەۋەبىدىن كېلىپ چىققان تالاش-تارتىش، زىيان ياكى قانۇنىي جاۋابكارلىقنى ئاچقۇچىلار ئۈستىگە ئالمايدۇ.\n\n4. **ئىشلەتكۈچىنىڭ ئۆزىنى باشقۇرۇشى**\nبۇ يۇمشاق دېتالنى ئىشلىتىشتىن بۇرۇن، ئىشلىتىش ھەرىكىتىڭىزنىڭ باشقىلارنىڭ بىلىم مۈلۈك ھوقۇقى، سودا مەخپىيەتلىكى ياكى باشقا قانۇنىي ھوقۇق-مەنپەئىتىگە دەخلى يەتكۈزمەيدىغانلىقىنى تولۇق چۈشىنىپ جەزملەشتۈرۈڭ. نامۇۋاپىق ئىشلىتىشتىن كېلىپ چىققان قانۇنىي تالاش-تارتىش ۋە ئاقىۋەتلەرنى ئىشلەتكۈچى ئۆزى ئۈستىگە ئالىدۇ.\n\nبۇ يۇمشاق دېتالنى ئىشلىتىش، ئىشلەتكۈچىنىڭ بۇ باياناتتىكى بارلىق ماددىلارنى ئوقۇغانلىقى، چۈشەنگەنلىكى ۋە قوشۇلغانلىقىنى بىلدۈرىدۇ. سوئالىڭىز بولسا كەسپىي قانۇن مەسلىھەتچىسىدىن سوراڭ.'
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
  tapeInspector,
  plan,
  ...others
}
