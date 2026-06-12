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

// Einzelne Top-Level-Keys
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
    'DeepChat ist lediglich ein Hilfswerkzeug. Wenn Benutzer aktiv eine Suche starten, organisiert und fasst DeepChat öffentliche Daten zusammen, die von Suchmaschinen zurückgegeben werden, damit Benutzer Suchergebnisse bequemer anzeigen und verstehen können.\n\n1. **Nutzung öffentlicher Daten**  \nDiese Software verarbeitet ausschließlich Daten, die auf Zielwebsites oder in Suchmaschinen öffentlich und ohne Anmeldung zugänglich sind. Bitte lesen und beachten Sie vor der Nutzung unbedingt die Nutzungsbedingungen der Zielwebsite oder Suchmaschine, um sicherzustellen, dass Ihre Nutzung rechtmäßig und regelkonform ist.  \n\n2. **Richtigkeit von Informationen und Verantwortung**  \nDie von dieser Software organisierten und erzeugten Inhalte dienen nur als Referenz und stellen keinerlei rechtliche, geschäftliche oder sonstige Beratung dar. Die Entwickler übernehmen keine Garantie für Richtigkeit, Vollständigkeit, Aktualität oder Rechtmäßigkeit der Suchergebnisse. Alle Folgen, die aus der Nutzung dieser Software entstehen, trägt der Benutzer selbst.  \n\n3. **Haftungsausschluss**  \nDiese Software wird im "Ist-Zustand" bereitgestellt. Die Entwickler übernehmen keine ausdrückliche oder stillschweigende Gewährleistung oder Verantwortung für Leistung, Stabilität oder Eignung. Wenn bei der Nutzung dieser Software Streitigkeiten, Verluste oder rechtliche Haftung durch Verstöße gegen geltende Gesetze, Vorschriften oder Regeln der Zielwebsite entstehen, übernehmen die Entwickler keine Verantwortung.  \n\n4. **Eigenverantwortung der Benutzer**  \nVor der Nutzung dieser Software sollten Benutzer vollständig verstehen und bestätigen, dass ihre Nutzung keine geistigen Eigentumsrechte, Geschäftsgeheimnisse oder sonstigen berechtigten Rechte anderer verletzt. Für rechtliche Streitigkeiten und Folgen, die aus unsachgemäßer Nutzung dieser Software durch Benutzer entstehen, sind ausschließlich die Benutzer selbst verantwortlich.  \n\nDie Nutzung dieser Software bedeutet, dass der Benutzer alle Bedingungen dieses Haftungsausschlusses gelesen, verstanden und akzeptiert hat. Bei Fragen wenden Sie sich bitte an einen professionellen Rechtsberater.'
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
