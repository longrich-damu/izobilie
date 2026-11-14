export const DAYS = 45;
export const STEP = 500000; // Тиыны: 5 000 тенге.
export const budget = number => number * STEP;
export const spent = day => day.purchases.reduce((sum, p) => sum + p.amount, 0);
export const remaining = day => budget(day.number) - spent(day);
export const localDate = (date = new Date()) => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value+'T12:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}
export function nextDate(value) {
  const date = new Date(value+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()+1);
  return date.toISOString().slice(0,10);
}
export function parseMoney(value) {
  const normalized = String(value).replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw Error('Укажи стоимость числом, например 15000 или 15000,50.');
  const [whole, fraction = ''] = normalized.split('.');
  const amount = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Error('Стоимость должна быть больше нуля.');
  return amount;
}
export function createJournal(name, start, today = localDate()) {
  if (!name.trim() || name.trim().length > 80) throw Error('Укажи имя, до 80 символов.');
  if (!isDate(start) || start > today) throw Error('Выбери сегодняшнюю или прошедшую дату начала.');
  return {schema:1, revision:0, profile:{name:name.trim(), startDate:start}, days:Array.from({length:DAYS},(_,i)=>({number:i+1,openedOn:i===0?start:null,completedOn:null,purchases:[]}))};
}
export function advance(journal, today = localDate()) {
  const index = journal.days.findIndex(d=>!d.completedOn);
  if (index <= 0) return false;
  const day = journal.days[index], previous = journal.days[index-1];
  if (!day.openedOn && previous.completedOn < today) {day.openedOn=today;return true;}
  return false;
}
export function game(journal) {
  const index = journal.days.findIndex(d=>!d.completedOn);
  if (index === -1) return {phase:'finished',day:journal.days[DAYS-1]};
  if (!journal.days[index].openedOn) return {phase:'waiting',day:journal.days[index-1]};
  return {phase:'active',day:journal.days[index]};
}
export function complete(journal, number, today = localDate()) {
  const current = game(journal);
  if (current.phase !== 'active' || current.day.number !== number || remaining(current.day)!==0) throw Error('Сначала распредели всю сумму сегодняшнего игрового дня.');
  current.day.completedOn = today;
}
export function putPurchase(journal, number, purchase, today = localDate()) {
  const day = journal.days[number-1];
  if (!day?.openedOn) throw Error('Этот день ещё не открыт.');
  const existing = day.purchases.find(p=>p.id===purchase.id);
  if (day.completedOn && (!existing || purchase.amount !== existing.amount)) throw Error('В завершённом дне сумма покупки сохраняется. Можно изменить название, заметку и фото.');
  const sum = spent(day)-(existing?.amount||0)+purchase.amount;
  if (!Number.isSafeInteger(purchase.amount) || purchase.amount<=0 || sum>budget(number)) throw Error('Стоимость превышает остаток этого дня.');
  if (!purchase.title.trim() || purchase.title.length>160) throw Error('Добавь название покупки, до 160 символов.');
  if (purchase.note.length>4000) throw Error('Заметка слишком длинная, оставь до 4000 символов.');
  const safe = {...purchase,title:purchase.title.trim(),createdOn:existing?.createdOn||today};
  if (existing) day.purchases[day.purchases.indexOf(existing)]=safe; else day.purchases.push(safe);
}
export function removePurchase(journal, number, id) {
  const day = journal.days[number-1];
  if (!day?.openedOn || day.completedOn) throw Error('Покупки завершённого дня сохраняются в истории.');
  day.purchases=day.purchases.filter(p=>p.id!==id);
}
export function totals(journal) {
  return {
    accrued:journal.days.filter(d=>d.openedOn).reduce((s,d)=>s+budget(d.number),0),
    spent:journal.days.reduce((s,d)=>s+spent(d),0),
    completed:journal.days.filter(d=>d.completedOn).length,
    purchases:journal.days.reduce((s,d)=>s+d.purchases.length,0)
  };
}
export function validateBackup(raw) {
  const invalid = () => {throw Error('Этот файл не похож на резервную копию «Моего изобилия» или содержит повреждённые записи.');};
  if (!raw || raw.schema!==1 || !raw.profile || typeof raw.profile.name!=='string' || !raw.profile.name.trim() || raw.profile.name.length>80 || !isDate(raw.profile.startDate) || !Array.isArray(raw.days) || raw.days.length!==DAYS) invalid();
  const ids = new Set();
  const days = raw.days.map((d,i)=>{
    if (!d || d.number!==i+1 || (d.openedOn!==null&&!isDate(d.openedOn)) || (d.completedOn!==null&&!isDate(d.completedOn)) || !Array.isArray(d.purchases) || d.purchases.length>500) invalid();
    const purchases = d.purchases.map(p=>{
      if (!p || typeof p.id!=='string' || p.id.length>100 || ids.has(p.id) || typeof p.title!=='string' || !p.title.trim() || p.title.length>160 || typeof p.note!=='string' || p.note.length>4000 || !Number.isSafeInteger(p.amount) || p.amount<=0 || !isDate(p.createdOn)) invalid();
      ids.add(p.id);
      if (p.photo!==null && (typeof p.photo!=='string' || p.photo.length>4000000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo))) invalid();
      return {id:p.id,title:p.title,amount:p.amount,note:p.note,photo:p.photo,createdOn:p.createdOn};
    });
    const day={number:i+1,openedOn:d.openedOn,completedOn:d.completedOn,purchases};
    if ((!day.openedOn && (day.completedOn||purchases.length)) || (day.completedOn && day.completedOn<day.openedOn) || spent(day)>budget(i+1) || (day.completedOn && remaining(day)!==0)) invalid();
    return day;
  });
  if (days[0].openedOn!==raw.profile.startDate) invalid();
  for (let i=1;i<DAYS;i++) if (days[i].openedOn && (!days[i-1].completedOn || days[i].openedOn<=days[i-1].completedOn)) invalid();
  return {schema:1,revision:Number.isSafeInteger(raw.revision)?Math.max(raw.revision,0):0,profile:{name:raw.profile.name.trim(),startDate:raw.profile.startDate},days};
}
