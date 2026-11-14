import {DAYS,budget,spent,remaining,localDate,nextDate,parseMoney,createJournal,advance,game,complete,putPurchase,removePurchase,totals,validateBackup} from './core.js';
import {MESSAGES} from './messages.js';

const $ = selector => document.querySelector(selector);
const main=$('#main'), nav=$('#nav'), purchaseDialog=$('#purchase-dialog'), form=$('#purchase-form');
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value/100)+' ₸';
const moneyInput = value => String(value/100).replace('.',',');
const prettyDate = (value,year=false) => new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',...(year?{year:'numeric'}:{})}).format(new Date(value+'T12:00:00'));
const todayLabel = () => {const d=new Date();return prettyDate(localDate(d))+' · '+new Intl.DateTimeFormat('ru-RU',{weekday:'long'}).format(d);};
const icons = {
  today:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  history:'<path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15"/>',
  stats:'<path d="M4 20h16M6 16V9m6 7V4m6 12v-5"/>',
  settings:'<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/>',
  plus:'<path d="M12 5v14M5 12h14"/>'
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
let journal=null, db, selectedDay=1, editing=null, pendingPhoto=null, photoVersion=0, photoReading=false, busy=false, lastDate=localDate(), toastTimer;
let writes=Promise.resolve();
const namespace = new URL('./',import.meta.url).pathname;
const channel = typeof BroadcastChannel!=='undefined' ? new BroadcastChannel('moe-izobilie-updates-v1:'+namespace) : null;

function openDatabase(){return new Promise((resolve,reject)=>{
  if(!window.indexedDB){reject(Error('Браузер не поддерживает сохранение дневника. Открой сайт в обычной вкладке современного браузера.'));return;}
  const request=indexedDB.open('moe-izobilie-v1:'+namespace,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('journal');
  request.onsuccess=()=>{const database=request.result;database.onversionchange=()=>database.close();resolve(database);};
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(Error('Закрой другие вкладки дневника и обнови страницу.'));
});}
function read(){return new Promise((resolve,reject)=>{const tx=db.transaction('journal','readonly');const r=tx.objectStore('journal').get('main');r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});}
function update(change){
  const task=()=>new Promise((resolve,reject)=>{
    const tx=db.transaction('journal','readwrite'), store=tx.objectStore('journal'), req=store.get('main');let result,error,changed=false;
    req.onsuccess=()=>{try{const current=req.result??null;const next=change(current);result=next===false?current:next;if(next!==false){changed=true;next.revision=(current?.revision??0)+1;store.put(next,'main');}}catch(e){error=e;tx.abort();}};
    tx.oncomplete=()=>{journal=result;if(changed)channel?.postMessage('changed');resolve(result);};
    tx.onerror=()=>reject(error||tx.error||Error('Не удалось сохранить запись.'));
    tx.onabort=()=>reject(error||tx.error||Error('Не удалось сохранить запись.'));
  });
  const result=writes.then(task);writes=result.catch(()=>{});return result;
}
function storageError(error){return error?.name==='QuotaExceededError'?'Места для фотографий не хватает. Скачай резервную копию и попробуй фотографию меньшего размера.':error?.message||'Не удалось сохранить. Проверь доступность хранилища браузера.';}
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').hidden=false;toastTimer=setTimeout(()=>{$('#toast').hidden=true;},4500);}
function heading(title,eyebrow='Мой дневник'){return `<div class="page-heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1></div></div>`;}
function wish(number){return `<section class="wish" aria-label="Послание дня"><div class="wish-label">Послание дня</div><p>${esc(MESSAGES[number-1])}</p></section>`;}
function balance(day,active=true){const used=spent(day),rest=remaining(day),percent=used/budget(day.number)*100;return `<section class="balance" aria-label="Бюджет игрового дня"><div class="balance-label">${active?'Сегодня тебе начислено':'Начислено в этот день'}</div><div class="amount">${esc(money(budget(day.number)).replace(' ₸',''))} <span class="currency">₸</span></div><div class="track" role="progressbar" aria-label="Потрачено из суммы дня" aria-valuenow="${used/100}" aria-valuemin="0" aria-valuemax="${budget(day.number)/100}"><div class="fill" style="width:${percent}%"></div></div><div class="balance-totals"><div>Потрачено<strong>${esc(money(used))}</strong></div><div>Осталось потратить<strong>${esc(money(rest))}</strong></div></div></section>`;}
function purchases(day){if(!day.purchases.length)return `<div class="empty"><div class="empty-symbol" aria-hidden="true">✳</div><h3>Что порадует тебя сегодня?</h3><p>Добавь первую покупку. Можно приложить фотографию и написать, почему тебе этого хочется.</p></div>`;return `<div class="purchase-grid">${day.purchases.map(p=>`<article class="purchase">${p.photo?`<button class="purchase-photo" type="button" data-action="photo" data-day="${day.number}" data-id="${esc(p.id)}" aria-label="Открыть фото: ${esc(p.title)}"><img src="${esc(p.photo)}" alt="${esc(p.title)}" loading="lazy"></button>`:''}<div class="purchase-content"><h4 class="purchase-title">${esc(p.title)}</h4><div class="purchase-amount">${esc(money(p.amount))}</div>${p.note?`<p class="purchase-note">${esc(p.note)}</p>`:''}<div class="purchase-actions"><button class="text-button" type="button" data-action="edit" data-day="${day.number}" data-id="${esc(p.id)}">Изменить</button>${!day.completedOn?`<button class="text-button danger" type="button" data-action="delete" data-day="${day.number}" data-id="${esc(p.id)}">Удалить</button>`:''}</div></div></article>`).join('')}</div>`;}
function renderWelcome(){
  nav.hidden=true;
  main.innerHTML=`<section class="welcome"><div class="eyebrow">45 игровых дней · твой личный дневник</div><h1>Тебе можно больше.</h1><p class="welcome-intro">Каждый день выбирай то, что радует тебя. Записывай покупки, добавляй фотографии и собирай свою историю желаний.</p>${wish(1)}<form id="welcome-form" class="welcome-form"><h2>Начнём твою игру</h2><label for="welcome-name">Как тебя зовут?</label><input id="welcome-name" name="name" required maxlength="80" autocomplete="given-name" placeholder="Твоё имя"><label for="welcome-date">Дата начала</label><input id="welcome-date" name="date" type="date" value="${localDate()}" max="${localDate()}" min="2020-01-01" required><div class="welcome-rules"><div><strong>5 000 ₸</strong><small>в первый день</small></div><div><strong>+5 000 ₸</strong><small>каждый новый день</small></div><div><strong>45</strong><small>игровых дней</small></div></div><p class="field-hint">Распредели сумму до нуля и заверши день. Следующий откроется завтра. Если пропустишь, игра подождёт тебя.</p><p id="welcome-error" class="form-error" role="alert"></p><button class="button primary full" type="submit">Начать мою игру ${icon('plus')}</button><p class="privacy-note">Покупки в игре воображаемые. Дневник и фотографии сохраняются в этом браузере. Для переноса на другое устройство скачивай резервную копию.</p></form><div class="saved-note">Уже играла раньше? <button class="text-button" data-action="import" type="button">Восстановить дневник из файла</button></div></section>`;
  $('#welcome-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,button=f.querySelector('button[type=submit]');button.disabled=true;try{const created=createJournal(f.elements.name.value,f.elements.date.value);await update(current=>{if(current)throw Error('Дневник уже открыт в другой вкладке. Обнови страницу.');return created;});location.hash='today';render();}catch(error){$('#welcome-error').textContent=storageError(error);button.disabled=false;}});
}
function renderToday(){
  const current=game(journal),day=current.day,t=totals(journal),name=journal.profile.name;
  let notice='';
  if(current.phase==='waiting')notice=`<div class="notice"><strong>Сегодня всё записано.</strong>День ${day.number+1} откроется ${esc(prettyDate(nextDate(day.completedOn)))}. А пока можно пересмотреть свои покупки.</div>`;
  if(current.phase==='finished')notice=`<section class="celebration"><h2>Ты прошла все 45 дней!</h2><p>В твоём дневнике ${esc(money(t.spent))} исполненных игровых желаний. Сохрани свою историю: к ней приятно возвращаться.</p><button class="button secondary" type="button" data-action="export">Скачать мой дневник</button></section>`;
  if(current.phase==='active'&&day.openedOn<localDate())notice='<div class="notice soft">Продолжим с того места, где ты остановилась.</div>';
  main.innerHTML=`<div class="page-heading"><div><div class="eyebrow">${esc(name)}, это время для тебя</div><h1>Сегодня для тебя.</h1><div class="date">${esc(todayLabel())}</div></div><span class="day-badge">День ${day.number} из 45</span></div>${notice}${wish(day.number)}${balance(day)}${current.phase==='active'?`<button class="button primary full add-button" data-action="add" data-day="${day.number}" type="button">${icon('plus')} Добавить покупку</button>`:''}<div class="all-time">С начала игры начислено <strong>${esc(money(t.accrued))}</strong></div><div class="section-heading"><h2>Мои покупки</h2><small>День ${day.number}</small></div>${purchases(day)}${current.phase==='active'?`<div class="finish-area"><button class="button ${remaining(day)===0?'primary':'outline'} full" data-action="complete" data-day="${day.number}" type="button" ${remaining(day)!==0?'disabled':''}>Завершить день ${day.number}</button><p class="field-hint">${remaining(day)===0?'Вся сумма распределена. Можно завершать день.':'Кнопка станет доступной, когда остаток будет равен нулю.'}</p></div>`:''}`;
}
function renderHistory(){
  if(!journal.days[selectedDay-1]?.openedOn)selectedDay=game(journal).day.number;
  const day=journal.days[selectedDay-1];
  main.innerHTML=`${heading('Моя история','Покупки, фотографии и желания')}<p class="legend">Выбери день, чтобы вернуться к своим записям. Галочкой отмечены завершённые дни.</p><div class="calendar" aria-label="45 игровых дней">${journal.days.map(d=>`<button type="button" class="day-cell ${d.completedOn?'complete':''} ${d.number===selectedDay?'selected':''}" data-action="day" data-day="${d.number}" aria-label="День ${d.number}${d.completedOn?', завершён':d.openedOn?', в процессе':', ещё не открыт'}" aria-pressed="${d.number===selectedDay}" ${!d.openedOn?'disabled':''}>${d.number}</button>`).join('')}</div><section class="history-detail" aria-label="Записи выбранного дня"><div class="section-heading"><h2>День ${day.number}</h2><span class="day-badge">${day.completedOn?'Завершён':'В процессе'}</span></div><div class="history-meta"><span>Начат ${esc(prettyDate(day.openedOn,true))}</span>${day.completedOn?`<span>Завершён ${esc(prettyDate(day.completedOn,true))}</span>`:''}</div>${wish(day.number)}${balance(day,false)}<div class="section-heading"><h2>Покупки этого дня</h2><small>${day.purchases.length}</small></div>${purchases(day)}${!day.completedOn?`<button class="button primary full add-button" data-action="add" data-day="${day.number}" type="button">${icon('plus')} Добавить покупку</button>`:''}</section>`;
}
function renderStats(){
  const t=totals(journal),weeks=Array.from({length:7},(_,i)=>{const days=journal.days.slice(i*7,i*7+7).filter(d=>d.openedOn);return {first:i*7+1,last:Math.min((i+1)*7,DAYS),days,accrued:days.reduce((s,d)=>s+budget(d.number),0),spent:days.reduce((s,d)=>s+spent(d),0)};}).filter(w=>w.days.length),max=Math.max(...weeks.map(w=>w.accrued),1);
  main.innerHTML=`${heading('Мои итоги','Посмотри, сколько желаний уже записано')}<div class="stats"><div class="stat"><div class="stat-label">Всего начислено</div><div class="stat-value">${esc(money(t.accrued))}</div><small>за открытые игровые дни</small></div><div class="stat"><div class="stat-label">Всего потрачено в игре</div><div class="stat-value">${esc(money(t.spent))}</div><small>по твоим покупкам</small></div><div class="stat"><div class="stat-label">Завершено дней</div><div class="stat-value">${t.completed} <small>из 45</small></div></div><div class="stat"><div class="stat-label">Покупок в дневнике</div><div class="stat-value">${t.purchases}</div></div></div><div class="weekly"><h2>По неделям игры</h2>${weeks.map((w,i)=>`<div class="week"><div class="week-title"><span>Неделя ${i+1}</span><small>Дни ${w.first}–${w.last}</small></div><div class="week-line"><span>Начислено</span><div class="bar-track" aria-hidden="true"><div class="bar" style="width:${w.accrued/max*100}%"></div></div><strong>${esc(money(w.accrued))}</strong></div><div class="week-line"><span>Потрачено</span><div class="bar-track" aria-hidden="true"><div class="bar berry" style="width:${w.spent/max*100}%"></div></div><strong>${esc(money(w.spent))}</strong></div></div>`).join('')}</div><p class="saved-note">Неделя здесь — семь игровых дней. Пропуски не добавляют начислений.</p><section class="settings-card"><h2>Весь путь</h2><p>В день 45 тебе будет начислено 225 000 ₸. За все 45 игровых дней поступит 5 175 000 ₸.</p></section>`;
}
function renderSettings(){
  main.innerHTML=`${heading('Мой дневник','Настройки и сохранение')}<form id="profile-form" class="settings-card"><h2>Как к тебе обращаться?</h2><label for="profile-name">Имя</label><input name="name" id="profile-name" value="${esc(journal.profile.name)}" required maxlength="80" autocomplete="given-name"><p id="profile-error" class="form-error" role="alert"></p><button class="button primary" type="submit">Сохранить имя</button></form><section class="settings-card"><h2>Моя игра</h2><div class="settings-row"><span>Дата начала</span><strong>${esc(prettyDate(journal.profile.startDate,true))}</strong></div><div class="settings-row"><span>Первое начисление</span><strong>5 000 ₸</strong></div><div class="settings-row"><span>Шаг каждого дня</span><strong>+5 000 ₸</strong></div><div class="settings-row"><span>Продолжительность</span><strong>45 игровых дней</strong></div></section><section class="settings-card"><h2>Сохранить мою историю</h2><p>Дневник хранится в этом браузере на этом устройстве. Записи сохраняются автоматически, но очистка данных браузера может их удалить. Скачивай копию время от времени: в ней будут покупки и фотографии.</p><div class="backup-actions"><button class="button primary" type="button" data-action="export">Скачать резервную копию</button><button class="button secondary" type="button" data-action="import">Восстановить из файла</button></div><p>Чтобы продолжить на другом устройстве, открой там этот сайт и восстанови скачанный файл. Изменения между устройствами автоматически не объединяются.</p></section><section class="settings-card"><h2>Правила, которые мы выбрали</h2><ol class="rules-list"><li>Каждый новый игровой день приносит на 5 000 ₸ больше предыдущего.</li><li>Запиши покупки на всю сумму и нажми «Завершить день».</li><li>Следующий день откроется на следующую календарную дату по времени устройства.</li><li>Пропустила? Спокойно продолжай незавершённый день. Записи и остаток сохранятся.</li><li>Все покупки и деньги в игре воображаемые.</li></ol></section><p class="saved-note">Послания написаны для этого дневника. Это авторские тексты, не цитаты.</p>`;
  $('#profile-form').addEventListener('submit',async e=>{e.preventDefault();const name=e.currentTarget.elements.name.value.trim();if(!name)return;const button=e.currentTarget.querySelector('button');button.disabled=true;try{await update(s=>{s.profile.name=name;return s;});toast('Имя сохранено');render();}catch(error){$('#profile-error').textContent=storageError(error);button.disabled=false;}});
}
function render(){
  if(!journal){renderWelcome();return;}
  const route=location.hash.slice(1),tab=['today','history','stats','settings'].includes(route)?route:'today';
  nav.hidden=false;nav.innerHTML=[['today','Сегодня'],['history','История'],['stats','Итоги'],['settings','Настройки']].map(([key,title])=>`<a href="#${key}" ${tab===key?'aria-current="page"':''}>${icon(key)}<span>${title}</span></a>`).join('');
  ({today:renderToday,history:renderHistory,stats:renderStats,settings:renderSettings}[tab])();
}
function downloadJournal(){if(!journal)return;const data={...journal,exportedAt:new Date().toISOString()};download(new Blob([JSON.stringify(data)],{type:'application/json'}),'moe-izobilie-'+localDate()+'.json');toast('Резервная копия подготовлена');}
function download(blob,name){const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function confirmAction(title,text,button='Продолжить') {return new Promise(resolve=>{const dialog=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-text').textContent=text;$('#confirm-ok').textContent=button;dialog.returnValue='';dialog.addEventListener('close',()=>resolve(dialog.returnValue==='yes'),{once:true});dialog.showModal();});}
$('#confirm-ok').addEventListener('click',()=>$('#confirm-dialog').close('yes'));
for(const id of ['#confirm-cancel','#confirm-close'])$(id).addEventListener('click',()=>$('#confirm-dialog').close('no'));
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
function openPurchase(number,id=null){
  const day=journal.days[number-1],p=day.purchases.find(p=>p.id===id);
  if(!day.openedOn||(!p&&day.completedOn))return;
  form.reset();photoVersion++;photoReading=false;editing={day:number,id:p?.id||crypto.randomUUID()};pendingPhoto=p?.photo||null;
  $('#purchase-heading').textContent=p?'Моя покупка':'Добавить покупку';
  $('#purchase-context').textContent='День '+number+' · '+(day.completedOn?'завершён':'осталось '+money(remaining(day)));
  form.elements.title.value=p?.title||'';form.elements.price.value=p?moneyInput(p.amount):'';form.elements.note.value=p?.note||'';
  form.elements.price.readOnly=Boolean(day.completedOn);
  $('#price-hint').textContent=day.completedOn?'День завершён. Название, заметку и фото можно изменить, сумму сохраняем.':'Можно потратить до '+money(remaining(day)+(p?.amount||0));
  $('#purchase-error').textContent='';$('#save-purchase').disabled=false;renderPhotoPreview();purchaseDialog.showModal();
}
function renderPhotoPreview(){const preview=$('#photo-preview');preview.hidden=!pendingPhoto;preview.querySelector('img').src=pendingPhoto||'';$('#photo-label').textContent=pendingPhoto?'Заменить фотографию':'Выбрать фотографию';}
$('#remove-photo').addEventListener('click',()=>{photoVersion++;photoReading=false;$('#save-purchase').disabled=false;pendingPhoto=null;form.elements.photo.value='';renderPhotoPreview();});
async function preparePhoto(file){
  if(!['image/jpeg','image/png','image/webp','image/avif','image/gif'].includes(file.type))throw Error('Выбери фотографию JPG, PNG, WebP, AVIF или GIF.');
  if(file.size>20*1024*1024)throw Error('Фотография больше 20 МБ. Выбери файл поменьше.');
  let image,url;
  try{
    if(typeof createImageBitmap==='function')image=await createImageBitmap(file,{imageOrientation:'from-image'});
    else {url=URL.createObjectURL(file);image=new Image();image.src=url;await image.decode();}
    const ratio=Math.min(1,1400/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    const result=canvas.toDataURL('image/jpeg',.84);if(result.length>4000000)throw Error('Фото слишком большое. Попробуй уменьшить его.');return result;
  }catch(error){throw Error(error.message.includes('слишком')?error.message:'Не удалось прочитать фотографию. Попробуй другой файл.');}
  finally{image?.close?.();if(url)URL.revokeObjectURL(url);}
}
form.elements.photo.addEventListener('change',async()=>{const file=form.elements.photo.files[0],version=++photoVersion;if(!file){photoReading=false;$('#save-purchase').disabled=false;return;}photoReading=true;$('#save-purchase').disabled=true;$('#purchase-error').textContent='';try{const photo=await preparePhoto(file);if(version!==photoVersion)return;pendingPhoto=photo;renderPhotoPreview();}catch(error){if(version===photoVersion)$('#purchase-error').textContent=error.message;}finally{if(version===photoVersion){photoReading=false;$('#save-purchase').disabled=false;}}});
form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||photoReading)return;busy=true;$('#save-purchase').disabled=true;$('#purchase-error').textContent='';
  try{const amount=parseMoney(form.elements.price.value),entry={id:editing.id,title:form.elements.title.value.trim(),amount,note:form.elements.note.value,photo:pendingPhoto};await update(s=>{putPurchase(s,editing.day,entry);return s;});purchaseDialog.close();render();toast('Покупка сохранена');}
  catch(error){$('#purchase-error').textContent=storageError(error);}finally{busy=false;$('#save-purchase').disabled=false;}
});
async function importJournal(){
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
  input.addEventListener('change',async()=>{const file=input.files[0];if(!file)return;try{
    if(file.size>60*1024*1024)throw Error('Файл больше 60 МБ. Выбери резервную копию дневника.');
    let raw;try{raw=JSON.parse(await file.text());}catch{throw Error('Не удалось прочитать файл. Нужна резервная копия в формате JSON.');}
    const restored=validateBackup(raw),summary=totals(restored);
    const approved=await confirmAction('Восстановить дневник?',`Имя: ${restored.profile.name}. Покупок: ${summary.purchases}, завершено дней: ${summary.completed}.${journal?' Текущий дневник будет заменён. Если он нужен, сначала отмени и скачай его резервную копию.':''}`,'Восстановить');
    if(!approved)return;
    await update(()=>{advance(restored);return restored;});selectedDay=game(journal).day.number;location.hash='today';render();toast('Дневник восстановлен вместе с фотографиями');
  }catch(error){toast(storageError(error));}});input.click();
}
main.addEventListener('click',async e=>{
  const button=e.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action,number=Number(button.dataset.day),id=button.dataset.id;
  try{
    if(action==='add'||action==='edit')openPurchase(number,id);
    if(action==='day'){selectedDay=number;renderHistory();}
    if(action==='export')downloadJournal();
    if(action==='import')await importJournal();
    if(action==='photo'){const p=journal.days[number-1].purchases.find(p=>p.id===id);if(p?.photo){$('#full-photo').src=p.photo;$('#full-photo').alt=p.title;$('#photo-dialog').showModal();}}
    if(action==='delete'){const p=journal.days[number-1].purchases.find(p=>p.id===id);if(await confirmAction('Удалить покупку?',`«${p.title}» будет удалена из дня ${number}. Её сумма снова станет доступна.`,'Удалить')){await update(s=>{removePurchase(s,number,id);return s;});render();toast('Покупка удалена');}}
    if(action==='complete'){if(await confirmAction('Завершить день '+number+'?','Все покупки останутся в истории. После завершения можно исправлять названия, заметки и фото; суммы этого дня сохраняются. Следующий день откроется завтра.','Завершить день')){button.disabled=true;await update(s=>{complete(s,number);return s;});render();toast(number===DAYS?'Ты прошла все 45 дней!':'День завершён. Ты молодец!');}}
  }catch(error){toast(storageError(error));button.disabled=false;}
});
window.addEventListener('hashchange',()=>{render();window.scrollTo({top:0});});
async function refresh(){if(!db||busy||purchaseDialog.open||$('#confirm-dialog').open)return;try{journal=await read();if(journal){await update(s=>{if(!s)return false;return advance(s)?s:false;});}render();lastDate=localDate();}catch(error){toast(storageError(error));}}
channel?.addEventListener('message',()=>refresh());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('focus',()=>{if(localDate()!==lastDate)refresh();});
setInterval(()=>{if(!document.hidden&&localDate()!==lastDate)refresh();},15000);
async function start(){try{db=await openDatabase();journal=await read();if(journal){journal=validateBackup(journal);await update(s=>advance(s)?s:false);selectedDay=game(journal).day.number;}render();}catch(error){nav.hidden=true;main.innerHTML=`<section class="fatal"><h1>Не удалось открыть дневник</h1><p>${esc(storageError(error))}</p><p>Попробуй обычную вкладку браузера с разрешённым хранением данных. Сохранённый дневник не удаляется.</p><button class="button primary" type="button" id="retry">Попробовать ещё раз</button></section>`;$('#retry').addEventListener('click',()=>location.reload());}}
start();
