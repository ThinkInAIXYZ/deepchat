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
  QwenLM: 'Qwen Model',
  Doubao: 'Volcano Engine',
  PPIO: 'PPIO Cloud',
  Moonshot: 'Moonshot AI',
  DashScope: 'Alibaba Bailian',
  Hunyuan: 'Hunyuan',
  searchDisclaimer:
    'DeepChat ᠨᠢ ᠵᠥᠪᠬᠡᠨ ᠲᠤᠰᠠᠯᠠᠬᠤ ᠪᠠᠭᠠᠵᠢ ᠪᠣᠯᠣᠨ᠎ᠠ ᠃ ᠬᠡᠷᠡᠭᠯᠡᠭᠴᠢᠳ ᠰᠠᠨᠠᠭᠠᠴᠢᠯᠠᠭ᠎ᠠ ᠠᠴᠠ ᠪᠠᠨ ᠡᠷᠢᠬᠦ ᠦᠶ᠎ᠡ ᠳᠦ ᠂ ᠲᠡᠷᠡ ᠨᠢ ᠡᠷᠢᠬᠦ ᠮᠠᠰᠢᠨ ᠤ ᠲᠡᠳᠡᠨ ᠦ ᠪᠤᠴᠠᠭᠠᠭᠰᠠᠨ ᠣᠯᠠᠨ ᠨᠡᠶᠢᠲᠡ ᠶᠢᠨ ᠮᠠᠲ᠋ᠧᠷᠢᠶᠠᠯ ᠢ ᠡᠮᠬᠢᠳᠬᠡᠵᠦ ᠂ ᠬᠡᠷᠡᠭᠯᠡᠭᠴᠢ ᠳᠦ ᠡᠷᠢᠯᠲᠡ ᠶᠢᠨ ᠦᠷ᠎ᠡ ᠳ᠋ᠦᠩ ᠢ ᠨᠡᠩ ᠳᠥᠭᠥᠮ ᠦᠵᠡᠬᠦ ᠳᠦ ᠠᠰᠢᠭᠲᠠᠢ ᠃ \n\n\n\nᠨᠢᠭᠡ ᠂ ** ᠣᠯᠠᠨ ᠨᠡᠶᠢᠲᠡ ᠶᠢᠨ ᠲᠣᠭ᠎ᠠ ᠪᠠᠷᠢᠮᠲᠠ ᠶᠢ ᠬᠡᠷᠡᠭᠯᠡᠵᠦ ᠪᠠᠶᠢᠭ᠎ᠠ ** \n\n ᠲᠤᠰ ᠵᠥᠭᠡᠯᠡᠨ ᠬᠡᠷᠡᠭᠰᠡᠯ  ᠢ ᠵᠥᠪᠬᠡᠨ ᠮᠡᠳᠡᠭᠡ ᠵᠠᠩᠭᠢ ᠶᠢᠨ ᠲᠣᠤᠷ ᠰᠦᠯᠵᠢᠶ᠎ᠡ ᠪᠤᠶᠤ ᠡᠷᠢᠬᠦ ᠮᠠᠰᠢᠨ ᠳᠤ ᠢᠯᠡ ᠪᠠᠶᠢᠬᠤ ᠶᠢᠨ ᠬᠠᠮᠲᠤ ᠰᠢᠩᠭᠡᠭᠡᠯᠲᠡ ᠶᠢᠨ ᠪᠠᠶᠢᠳᠠᠯ  ᠢ ᠲᠡᠮᠳᠡᠭᠯᠡᠬᠦ ᠦᠭᠡᠶ ᠪᠡᠷ ᠣᠷᠣᠵᠤ ᠳᠡᠶᠢᠯᠬᠦ ᠲᠣᠭ᠎ᠠ ᠪᠠᠷᠢᠮᠲᠠ ᠶᠢ ᠰᠢᠶᠳᠪᠦᠷᠢᠯᠡᠨ᠎ᠡ ᠃ ᠬᠡᠷᠡᠭᠯᠡᠭᠴᠢ ᠶᠢ ᠬᠡᠷᠡᠭᠯᠡᠬᠦ ᠡᠴᠡ ᠡᠮᠦᠨ᠎ᠡ ᠂ ᠲᠡᠭᠦᠨ ᠦ ᠲᠣᠤᠷ ᠰᠦᠯᠵᠢᠶᠡᠨ ᠦ ᠥᠷᠲᠡᠭᠡ ᠪᠤᠶᠤ ᠡᠷᠢᠬᠦ ᠮᠠᠰᠢᠨ ᠤ ᠦᠢᠯᠡᠴᠢᠯᠡᠭᠡᠨ ᠦ ᠵᠦᠢᠯ ᠵᠤᠷᠪᠤᠰ  ᠢ ᠤᠩᠰᠢᠬᠤ ᠶᠢᠨ ᠬᠠᠮᠲᠤ ᠵᠢᠷᠤᠮᠯᠠᠨ ᠰᠠᠬᠢᠵᠤ ᠂ ᠬᠡᠷᠡᠭᠯᠡᠬᠦ ᠳᠦᠨᠢ ᠬᠠᠤᠯᠢ ᠶᠣᠰᠣᠨ ᠳᠤ ᠨᠡᠶᠢᠴᠡᠬᠦ ᠶᠢ ᠪᠠᠲᠤᠯᠠᠬᠤ ᠬᠡᠷᠡᠭᠲᠡᠶ ᠃ \n\n\n\nᠬᠣᠶᠠᠷ᠂    ᠮᠡᠳᠡᠭᠡ ᠵᠠᠩᠭᠢ ᠶᠢᠨ ᠵᠥᠪ ᠣᠨᠣᠪᠴᠢ ᠬᠢᠭᠡᠳ ᠬᠠᠷᠢᠭᠤᠴᠠᠯᠭ᠎ᠠ ᠶᠢᠨ ᠴᠢᠨᠠᠷ** \n\n  ᠲᠤᠰ ᠵᠥᠭᠡᠯᠡᠨ ᠲᠣᠨᠣᠭ ᠤᠨ ᠵᠣᠬᠢᠶᠠᠨ ᠪᠦᠲᠦᠭᠡᠭᠰᠡᠨ ᠠᠭᠤᠯᠭ᠎ᠠ ᠨᠢ ᠯᠠᠪᠯᠠᠯᠲᠠ ᠪᠣᠯᠭᠠᠬᠤ ᠳᠤ ᠬᠡᠷᠡᠭᠯᠡᠬᠦ ᠡᠴᠡ ᠪᠢᠰᠢ ᠶᠠᠮᠠᠷᠪᠠ ᠬᠠᠤᠯᠢ ᠴᠠᠭᠠᠵᠠ ᠂ ᠠᠷᠠᠯᠵᠢᠶ᠎ᠠ ᠪᠤᠶᠤ ᠪᠤᠰᠤᠳ ᠰᠠᠨᠠᠭᠤᠯᠭ᠎ᠠ ᠳᠤ ᠪᠠᠭᠲᠠᠬᠤ ᠦᠭᠡᠶ ᠃ ᠨᠡᠭᠡᠭᠡᠨ ᠬᠥᠭᠵᠢᠭᠦᠯᠦᠭᠴᠢ ᠨᠢ ᠡᠷᠢᠭᠰᠡᠨ ᠦᠷ᠎ᠡ ᠳ᠋ᠦᠩ ᠦᠨ ᠣᠨᠣᠪᠴᠢᠲᠤ ᠴᠢᠨᠠᠷ ᠂ ᠪᠦᠷᠢᠨ ᠭᠦᠢᠴᠡᠳ ᠂ ᠴᠠᠭ ᠲᠤᠬᠠᠶᠢᠴᠢ ᠴᠢᠨᠠᠷ ᠂ ᠬᠠᠤᠯᠢ ᠶᠣᠰᠣᠨ ᠤ ᠴᠢᠨᠠᠷ ᠲᠤ ᠪᠠᠲᠤᠯᠠᠭ᠎ᠠ ᠦᠭᠡᠶ ᠃ ᠲᠤᠰ ᠵᠥᠭᠡᠯᠡᠨ ᠲᠣᠨᠣᠭ  ᠢ ᠬᠡᠷᠡᠭᠯᠡᠭᠰᠡᠨ ᠡᠴᠡ ᠪᠣᠯᠤᠭᠰᠠᠨ ᠠᠯᠢᠪᠠ ᠦᠷ᠎ᠡ ᠳ᠋ᠦᠩ  ᠢ ᠬᠡᠷᠡᠭᠯᠡᠭᠴᠢ ᠡᠭᠦᠷᠭᠡᠯᠡᠬᠦ ᠬᠡᠷᠡᠭᠲᠡᠶ ᠃ \n\n\n\nᠭᠤᠷᠪᠠ᠂    ᠪᠢᠲᠡᠭᠦᠮᠵᠢᠯᠡᠯᠲᠡ ᠶᠢ ᠲᠣᠳᠣᠷᠬᠠᠶᠢᠯᠠᠯ ᠤᠨ ᠪᠢᠴᠢᠭ \n\n  ᠲᠤᠰ ᠵᠥᠭᠡᠯᠡᠨ ᠲᠣᠨᠣᠭ  ᠢ 《 ᠤᠭ ᠶᠣᠰᠣᠭᠠᠷ 》 ᠬᠠᠩᠭᠠᠭᠰᠠᠨ ᠃ ᠨᠡᠭᠡᠭᠡᠭᠴᠢ ᠨᠢ ᠲᠡᠭᠦᠨ ᠦ ᠴᠢᠳᠠᠮᠵᠢ ᠂ ᠲᠣᠭᠲᠠᠭᠤᠨ ᠴᠢᠨᠠᠷ ᠂ ᠬᠡᠷᠡᠭᠯᠡᠭᠡᠨ ᠳᠦ ᠢᠯᠡᠷᠬᠡᠶ ᠪᠤᠶᠤ ᠳᠠᠯᠳᠠ ᠮᠠᠶ᠋ᠢᠭ ᠤᠨ ᠪᠠᠲᠤᠯᠠᠭ᠎ᠠ ᠭᠠᠷᠭᠠᠬᠤ ᠦᠭᠡᠶ ᠂ ᠶᠠᠮᠠᠷᠪᠠ ᠬᠠᠷᠢᠭᠤᠴᠠᠯᠭ᠎ᠠ ᠶᠢ ᠡᠭᠦᠷᠭᠡᠯᠡᠬᠦ ᠦᠭᠡᠶ ᠃ ᠲᠤᠰ ᠵᠥᠭᠡᠯᠡᠨ ᠲᠣᠨᠣᠭ  ᠢ ᠬᠡᠷᠡᠭᠯᠡᠵᠦ ᠪᠠᠶᠢᠬᠤ ᠶᠠᠪᠤᠴᠠ ᠳᠤ ᠂ ᠬᠣᠯᠪᠣᠭᠳᠠᠯ ᠪᠦᠬᠦᠢ ᠬᠠᠤᠯᠢ ᠴᠠᠭᠠᠵᠠ ᠬᠠᠤᠯᠢ ᠲᠣᠭᠲᠠᠭᠠᠯ ᠪᠤᠶᠤ ᠲᠣᠤᠷ ᠰᠦᠯᠵᠢᠶᠡᠨ ᠦ ᠥᠷᠲᠡᠭᠡ ᠶᠢᠨ ᠳᠦᠷᠢᠮ ᠡᠴᠡ ᠵᠥᠷᠢᠴᠡᠭᠰᠡᠨ ᠡᠴᠡ ᠪᠣᠯᠤᠭᠰᠠᠨ ᠠᠯᠢᠪᠠ ᠵᠢᠭᠤᠷᠠᠯᠳᠤᠭᠠᠨ ᠂ ᠬᠣᠬᠢᠷᠠᠯ ᠪᠤᠶᠤ ᠬᠠᠤᠯᠢ ᠴᠠᠭᠠᠵᠠ ᠶᠢᠨ ᠬᠠᠷᠢᠭᠤᠴᠠᠯᠭ᠎ᠠ ᠨᠢ ᠨᠡᠭᠡᠭᠡᠨ ᠬᠥᠭᠵᠢᠭᠦᠯᠦᠭᠴᠢ ᠬᠠᠷᠢᠭᠤᠴᠠᠯᠭ᠎ᠠ ᠡᠭᠦᠷᠭᠡᠯᠡᠬᠦ ᠦᠭᠡᠶ ᠃ \n\n\n\n4. ** ᠬᠡᠷᠡᠭᠯᠡᠭᠴᠢ ᠶᠢᠨ ᠥᠪᠡᠷ ᠢ ᠪᠡᠨ ᠱᠠᠭᠠᠷᠳᠠᠬᠤ** \n\n ᠬᠡᠷᠡᠭᠯᠡᠭᠴᠢ ᠲᠤᠰ ᠵᠥᠭᠡᠯᠡᠨ ᠬᠡᠷᠡᠭᠰᠡᠯ  ᠢ ᠬᠡᠷᠡᠭᠯᠡᠬᠦ ᠡᠴᠡ ᠡᠮᠦᠨ᠎ᠡ ᠂ ᠬᠡᠷᠡᠭᠯᠡᠬᠦ ᠳᠡᠭᠡᠨ ᠮᠡᠳᠡᠯᠭᠡ ᠶᠢᠨ ᠪᠦᠲᠦᠭᠡᠭᠳᠡᠬᠦᠨ ᠦ ᠥᠮᠴᠢᠯᠡᠬᠦ ᠡᠷᠬᠡ ᠂ ᠬᠤᠳᠠᠯᠳᠤᠭᠠᠨ ᠤ ᠨᠢᠭᠤᠴᠠ ᠪᠤᠶᠤ ᠪᠤᠰᠤᠳ ᠬᠠᠤᠯᠢ ᠶᠣᠰᠣᠨ ᠤ ᠡᠷᠬᠡ ᠠᠰᠢᠭ ᠲᠤ ᠬᠠᠯᠳᠠᠬᠤ ᠦᠭᠡᠶ ᠭᠡᠳᠡᠭ  ᠢ ᠭᠦᠢᠴᠡᠳ ᠣᠶᠢᠯᠠᠭᠠᠬᠤ ᠶᠢᠨ ᠬᠠᠮᠲᠤ ᠨᠤᠲᠠᠯᠠᠬᠤ ᠬᠡᠷᠡᠭᠲᠡᠶ ᠃ ᠬᠡᠷᠡᠭᠯᠡᠭᠴᠢ ᠲᠤᠰ ᠵᠥᠭᠡᠯᠡᠨ ᠲᠣᠨᠣᠭ  ᠢ ᠬᠡᠪ ᠦᠨ ᠶᠣᠰᠣᠭᠠᠷ ᠬᠡᠷᠡᠭᠯᠡᠭᠰᠡᠨ ᠡᠴᠡ ᠪᠣᠯᠤᠭᠰᠠᠨ ᠬᠠᠤᠯᠢ ᠴᠠᠭᠠᠵᠠ ᠶᠢᠨ ᠮᠠᠷᠭᠤᠯᠳᠤᠭᠠᠨ ᠪᠠ ᠦᠷ᠎ᠡ ᠳ᠋ᠦᠩ ᠳᠦ ᠪᠣᠯ ᠲᠤᠰ ᠪᠡᠶ᠎ᠡ ᠶᠢᠨ ᠬᠠᠷᠢᠭᠤᠴᠠᠯᠭ᠎ᠠ ᠶᠢ ᠡᠭᠦᠷᠭᠡᠯᠡᠬᠦ ᠬᠡᠷᠡᠭᠲᠡᠶ ᠃ \n\n\n\nᠡᠨᠡ ᠬᠦ ᠵᠥᠭᠡᠯᠡᠨ ᠲᠣᠨᠣᠭ ᠢ ᠬᠡᠷᠡᠭᠯᠡᠬᠦ ᠪᠡᠷ ᠳᠠᠮᠵᠢᠨ ᠂ ᠬᠡᠷᠡᠭ᠍ᠯᠡᠭ᠍ᠴᠢᠳ ᠲᠤᠰ ᠦᠭᠡᠢ᠌ᠯᠡᠬᠦ ᠪᠢᠴᠢᠭ᠌ ᠦᠨ ᠪᠤᠢ ᠪᠥᠬᠥᠢ ᠵᠦᠢᠯ ᠵᠤᠷᠪᠤᠰ ᠢ ᠨᠢᠭᠡᠨᠲᠡ ᠤᠩᠰᠢᠵᠤ ᠂ ᠣᠢ᠌ᠯᠠᠭᠠᠭᠰᠠᠨ ᠪᠠ ᠵᠥᠪᠰᠢᠶᠡᠷᠡᠭ᠍ᠰᠡᠨ ᠭᠡᠳᠡᠭ᠍ ᠢ ᠢᠯᠡᠷᠬᠡᠢ᠌ᠯᠡᠨ᠎ᠡ ᠃ ᠰᠡᠵᠢᠭᠯᠡᠯᠲᠡᠢ ᠪᠠᠢ᠌ᠪᠠᠯ ᠂ ᠲᠤᠰᠬᠠᠢ ᠬᠠᠤᠯᠢᠴᠢ ᠶᠢᠨ ᠵᠥᠪᠯᠡᠭ᠍ᠴᠢ ᠡᠴᠡ ᠠᠰᠠᠭᠤᠭᠠᠷᠠᠢ ᠃'
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
