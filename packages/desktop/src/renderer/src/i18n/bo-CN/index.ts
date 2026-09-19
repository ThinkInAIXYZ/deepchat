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

// Individual top-level keys
const others = {
  Silicon: 'SiliconFlow',
  Qiniu: 'Qiniu',
  QwenLM: 'Qwen',
  Doubao: 'Volcano Engine',
  PPIO: 'PPIO Cloud',
  Moonshot: 'Moonshot AI',
  DashScope: 'Alibaba Bailian',
  Hunyuan: 'Hunyuan',
  Zhipu: 'Zhipu',
  searchDisclaimer:
    'DeepChat ནི་རམ་འདེགས་ལག་ཆ་ཁོ་ན་ཡིན། སྤྱོད་མཁན་གྱིས་རང་འགུལ་གྱིས་འཚོལ་བཤེར་འགོ་འཛུགས་སྐབས། འཚོལ་བཤེར་འཕྲུལ་ཆས་ཀྱིས་ཕྱིར་སྤྲད་པའི་ཡོངས་བསྒྲགས་གཞི་གྲངས་སྒྲིག་བསྡུ་དང་ཕྱོགས་བསྡོམས་བྱས་ཏེ། སྤྱོད་མཁན་གྱིས་འཚོལ་བཤེར་འབྲས་བུ་སྟབས་བདེར་ལྟ་བ་དང་གོ་བ་ལེན་པར་རོགས་རམ་བྱེད།\n\n1. **ཡོངས་བསྒྲགས་གཞི་གྲངས་བེད་སྤྱོད།**\nམཉེན་ཆས་འདིས་དམིགས་ཡུལ་དྲ་ཚིགས་སམ་འཚོལ་བཤེར་འཕྲུལ་ཆས་ཀྱིས་ཡོངས་བསྒྲགས་བྱས་པ་དང་ནང་འཛུལ་མི་དགོས་པར་ལྟ་ཐུབ་པའི་གཞི་གྲངས་ཁོ་ན་ཐག་གཅོད་བྱེད། སྤྱོད་པའི་སྔོན་དུ་དམིགས་ཡུལ་དྲ་ཚིགས་སམ་འཚོལ་བཤེར་འཕྲུལ་ཆས་ཀྱི་ཞབས་ཞུའི་ཆ་རྐྱེན་བཀླགས་ནས་བརྩི་སྲུང་བྱས་ཏེ། བེད་སྤྱོད་ཁྲིམས་དང་སྒྲིག་སྲོལ་དང་མཐུན་པ་བྱེད་དགོས།\n\n2. **ཆ་འཕྲིན་གྱི་ཡང་དག་རང་བཞིན་དང་འགན་འཁྲི།**\nམཉེན་ཆས་འདིས་སྒྲིག་བསྡུ་དང་སྐྱེད་པའི་ནང་དོན་ནི་དཔྱད་གཞི་ཁོ་ན་ཡིན། བཅའ་ཁྲིམས། ཚོང་ལས་སམ་གཞན་གྱི་བསམ་འཆར་གང་ཡང་མི་མཚོན། གསར་སྤེལ་མཁན་གྱིས་འཚོལ་བཤེར་འབྲས་བུའི་ཡང་དག་རང་བཞིན། ཆ་ཚང་རང་བཞིན། དུས་ཐོག་རང་བཞིན་དང་ཁྲིམས་མཐུན་རང་བཞིན་ལ་ཁག་ཐེག་མི་བྱེད། མཉེན་ཆས་འདི་སྤྱད་པ་ལས་བྱུང་བའི་མཇུག་འབྲས་ཡོད་ཚད་སྤྱོད་མཁན་རང་གིས་འགན་འཁུར་དགོས།\n\n3. **འགན་འཁྲི་སེལ་བའི་དོན་ཚན།**\nམཉེན་ཆས་འདི་“ད་ཡོད་རྣམ་པ” ལྟར་མཁོ་འདོན་བྱེད། གསར་སྤེལ་མཁན་གྱིས་དེའི་ནུས་པ། བརྟན་ལྷིང་རང་བཞིན་དང་སྤྱོད་འཚམ་རང་བཞིན་ལ་མངོན་གསལ་ལམ་ཤུགས་བསྟན་གྱི་ཁག་ཐེག་གམ་འགན་འཁྲི་གང་ཡང་མི་འཁུར། མཉེན་ཆས་འདི་སྤྱོད་སྐབས་འབྲེལ་ཡོད་བཅའ་ཁྲིམས་དང་ཁྲིམས་སྲོལ་ལམ་དམིགས་ཡུལ་དྲ་ཚིགས་ཀྱི་སྒྲིག་སྲོལ་དང་འགལ་བ་ལས་བྱུང་བའི་རྩོད་གཞི། གྱོང་གུན་ནམ་བཅའ་ཁྲིམས་ཀྱི་འགན་འཁྲི་ཡོད་ཚད་ལ་གསར་སྤེལ་མཁན་གྱིས་འགན་མི་འཁུར།\n\n4. **སྤྱོད་མཁན་གྱི་རང་གཅུན།**\nམཉེན་ཆས་འདི་མ་སྤྱད་སྔོན་དུ་སྤྱོད་མཁན་གྱིས་རང་གི་བེད་སྤྱོད་ཀྱིས་གཞན་གྱི་ཤེས་བྱའི་ཐོན་དངོས་བདག་དབང་། ཚོང་ལས་གསང་བའམ་ཁྲིམས་མཐུན་ཁེ་དབང་གཞན་ལ་གནོད་མི་སྲིད་པ་གོ་བ་གང་ལེགས་ལེན་པ་དང་གཏན་འཁེལ་བྱེད་དགོས། སྤྱོད་སྟངས་མི་འཚམ་པ་ལས་བྱུང་བའི་བཅའ་ཁྲིམས་རྩོད་གཞི་དང་མཇུག་འབྲས་ཡོད་ཚད་སྤྱོད་མཁན་རང་གིས་འགན་འཁུར་དགོས།\n\nམཉེན་ཆས་འདི་སྤྱད་པ་ནི་སྤྱོད་མཁན་གྱིས་འགན་འཁྲི་སེལ་བའི་གསལ་བསྒྲགས་འདིའི་དོན་ཚན་ཡོད་ཚད་བཀླགས་ནས་གོ་བ་ལེན་པ་དང་མོས་མཐུན་བྱས་པ་མཚོན། དོགས་གཞི་ཡོད་ན་ཆེད་ལས་བཅའ་ཁྲིམས་བློ་འདྲི་མཁན་ལ་འདྲི་རོགས།'
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
