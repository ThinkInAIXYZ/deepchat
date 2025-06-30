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
    'دیپ‌چت تنها ابزاری کمکی است که داده‌های عمومی بازگردانده‌شده توسط موتورهای جستجو را هنگام شروع فعال جستجو توسط کاربران، سازماندهی و خلاصه می‌کند تا به کاربران کمک کند نتایج جستجو را بهتر مشاهده و درک کنند.\n۱. استفاده از داده‌های عمومی\nاین نرم‌افزار تنها داده‌های قابل دسترسی عمومی روی سایت‌های هدف یا موتورهای جستجو را بدون نیاز به ورود پردازش می‌کند. قبل از استفاده، لطفاً شرایط استفاده از سایت یا موتور جستجوی هدف را مطالعه و رعایت کنید تا قانونی بودن استفاده‌تان را تضمین کنید.\n۲. دقت و مسئولیت اطلاعات\nمحتوای سازماندهی و تولیدشده توسط این نرم‌افزار صرفاً برای مرجع ارائه می‌شود و هیچ‌گاه مشاوره حقوقی، تجاری یا غیره محسوب نمی‌شود. توسعه‌دهندگان دقت، کامل بودن، به‌روز بودن یا قانونی بودن نتایج جستجو را تضمین نمی‌کنند و هرگونه پیامد ناشی از استفاده از این نرم‌افزار بر عهده کاربر است.\n۳. بند عدم مسئولیت\nاین نرم‌افزار "همان‌طور که هست" ارائه می‌شود و توسعه‌دهندگان هیچ ضمانت صریح یا ضمنی در مورد عملکرد، پایداری یا قابلیت کاربرد آن نمی‌پذیرند. هنگام استفاده از این نرم‌افزار، توسعه‌دهندگان هیچ مسئولیتی برای اختلاف، ضرر یا مسئولیت حقوقی ناشی از نقض قوانین و مقررات مربوطه یا قوانین سایت هدف نمی‌پذیرند.\n۴. خودانضباطی کاربر\nقبل از استفاده از این نرم‌افزار، کاربران باید به‌طور کامل درک و تأیید کنند که استفاده‌شان به حقوق مالکیت فکری، اسرار تجاری یا سایر حقوق مشروع دیگران آسیب نمی‌رساند. هرگونه اختلاف یا پیامد حقوقی ناشی از استفاده نامناسب از این نرم‌افزار توسط کاربران بر عهده خودشان است.\nاستفاده از این نرم‌افزار نشان می‌دهد که کاربر تمام شرایط این بند عدم مسئولیت را خوانده، درک کرده و پذیرفته است. در صورت تردید، لطفاً با مشاور حقوقی حرفه‌ای مشورت کنید.'
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
