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
    'DeepChat הוא כלי עזר בלבד המארגן ומסכם נתונים ציבוריים המוחזרים על ידי מנועי חיפוש כאשר משתמשים יוזמים חיפושים באופן פעיל, ומסייע למשתמשים לצפות ולהבין את תוצאות החיפוש בצורה נוחה יותר.\n1. שימוש בנתונים ציבוריים\nתוכנה זו מעבדת רק נתונים הזמינים באופן ציבורי באתרי היעד או במנועי החיפוש ללא צורך בהתחברות. לפני השימוש, אנא הקפד לעיין ולציית לתנאי השירות של אתר היעד או מנוע החיפוש כדי להבטיח שהשימוש שלך חוקי ותואם לכללים.\n2. דיוק המידע ואחריות\nהתוכן המאורגן והנוצר על ידי תוכנה זו הוא לעיון בלבד ואינו מהווה כל צורה של ייעוץ משפטי, עסקי או אחר. המפתחים אינם מספקים ערובות לגבי הדיוק, השלמות, העדכניות או החוקיות של תוצאות החיפוש, וכל תוצאה הנובעת משימוש בתוכנה זו הינה באחריות המשתמש בלבד.\n3. סעיף ויתור (Disclaimer)\nתוכנה זו מסופקת "כפי שהיא" (as is), והמפתחים אינם נושאים באחריות מפורשת או משתמעת לביצועיה, יציבותה או התאמתה. במהלך השימוש בתוכנה זו, המפתחים אינם נושאים באחריות לכל מחלוקת, אובדן או חבות משפטית הנובעים מהפרות של חוקים ותקנות רלוונטיים או כללי אתר היעד.\n4. משמעת עצמית של המשתמש\nלפני השימוש בתוכנה זו, על המשתמשים להבין היטב ולאשר שהשימוש שלהם לא יפגע בזכויות קניין רוחני, סודות מסחריים או זכויות לגיטימיות אחרות של אחרים. כל מחלוקת משפטית ותוצאות הנובעות משימוש לא נאות בתוכנה זו על ידי משתמשים הינן באחריות המשתמשים בלבד.\nהשימוש בתוכנה זו מציין שהמשתמש קרא, הבין והסכים לכל תנאי כתב ויתור זה. אם יש לך שאלות, אנא התייעץ עם יועץ משפטי מקצועי.'
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
