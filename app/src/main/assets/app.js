const DATA_KEY='vocab_flashcards_v4';
const OLD_KEYS=['vocab_flashcards_v3','vocab_flashcards_v2'];
const SETTINGS_KEY='vocab_flashcards_settings_v2';
const HEADER=['word','ipa','pronunciation_fa','part_of_speech','meaning_fa','example_en','example_fa','lesson','level','sense_order','notes'];
const DEFAULT_LESSON='درس ۱۰ — Is There a Safe Way to Drink?';

let cards=[];
let queue=[];
let queueIndex=0;
let revealed=false;
let typedChecked=false;
let settings={accent:'en-US',speechRate:0.85,autoSpeak:false,leechThreshold:6};

const $=id=>document.getElementById(id);
const now=()=>Date.now();
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,9);
const esc=(s='')=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const attr=(s='')=>esc(s).replace(/\n/g,' ');
const jsq=(s='')=>String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");

function blankReview(src={}){
  return {
    stage:Number(src.stage||0),
    dueAt:Number(src.dueAt||0),
    lastRating:src.lastRating||'',
    knownCount:Number(src.knownCount||0),
    missedCount:Number(src.missedCount||0),
    reviewCount:Number(src.reviewCount||0),
    lapses:Number(src.lapses ?? src.missedCount ?? 0),
    leech:Boolean(src.leech||false),
    lastReviewedAt:Number(src.lastReviewedAt||0)
  };
}

function normalizeSense(s={}){
  return {
    id:s.id||uid(),
    meaning:String(s.meaning||'').trim(),
    example:String(s.example||'').trim(),
    translation:String(s.translation||'').trim(),
    review:blankReview(s.review||{})
  };
}

function normalizeCard(c={}){
  let rawSenses=Array.isArray(c.senses)?c.senses:[{
    meaning:c.meaning||'',
    example:c.example||'',
    translation:c.translation||''
  }];
  let senses=rawSenses.map(normalizeSense).filter(s=>s.meaning||s.example||s.translation);
  if(!senses.length)senses=[normalizeSense()];
  const legacyReview={
    stage:c.stage,dueAt:c.dueAt,lastRating:c.lastRating,knownCount:c.knownCount,
    missedCount:c.missedCount,reviewCount:c.reviewCount,lapses:c.lapses,leech:c.leech,lastReviewedAt:c.lastReviewedAt
  };
  return {
    id:c.id||uid(),
    word:String(c.word||'').trim(),
    ipa:String(c.ipa||'').trim(),
    pronunciationFa:String(c.pronunciationFa||c.pronunciation_fa||'').trim(),
    partOfSpeech:String(c.partOfSpeech||c.part_of_speech||'').trim(),
    lesson:String(c.lesson||'بدون درس').trim(),
    level:String(c.level||'B2').trim()||'B2',
    notes:String(c.notes||'').trim(),
    senses,
    masterReview:blankReview(c.masterReview||legacyReview),
    createdAt:Number(c.createdAt||Date.now()),
    updatedAt:Number(c.updatedAt||Date.now())
  };
}

function cardKey(c){
  return (c.word||'').trim().toLowerCase()+'|'+(c.lesson||'').trim().toLowerCase();
}
function senseKey(s){
  return (s.meaning||'').trim().toLowerCase()+'|'+(s.example||'').trim().toLowerCase();
}
function getSense(card,senseId){
  return card.senses.find(s=>String(s.id)===String(senseId));
}
function getReviewState(item){
  const c=cards.find(x=>String(x.id)===String(item.cardId));
  if(!c)return null;
  if(item.kind==='master')return c.masterReview;
  const s=getSense(c,item.senseId);
  return s?s.review:null;
}
function stateIsDue(s){
  return !s.dueAt||s.dueAt<=now();
}
function cardHasLeech(c){
  return c.masterReview.leech||c.senses.some(s=>s.review.leech);
}
function cardHasHard(c){
  const hard=s=>s.lastRating==='again'||s.lastRating==='hard';
  return hard(c.masterReview)||c.senses.some(x=>hard(x.review));
}
function cardIsDue(c){
  return stateIsDue(c.masterReview)||c.senses.some(s=>stateIsDue(s.review));
}
function cardMastered(c){
  return c.masterReview.stage>=6&&c.senses.every(s=>s.review.stage>=5);
}
function nextDueForCard(c){
  const values=[c.masterReview.dueAt,...c.senses.map(s=>s.review.dueAt)].filter(Boolean);
  return values.length?Math.min(...values):0;
}
function totalSenseCount(){
  return cards.reduce((n,c)=>n+c.senses.length,0);
}
function totalLeeches(){
  let n=0;
  cards.forEach(c=>{
    if(c.masterReview.leech)n++;
    c.senses.forEach(s=>{if(s.review.leech)n++});
  });
  return n;
}
function totalDueItems(){
  let n=0;
  cards.forEach(c=>{
    if(stateIsDue(c.masterReview))n++;
    c.senses.forEach(s=>{if(stateIsDue(s.review))n++});
  });
  return n;
}
function totalReviews(){
  return cards.reduce((n,c)=>n+c.masterReview.reviewCount+c.senses.reduce((a,s)=>a+s.review.reviewCount,0),0);
}

function loadSeedPayload(){
  try{
    if(window.Android&&Android.getSeedData)return JSON.parse(Android.getSeedData());
  }catch(e){}
  return {version:0,cards:[]};
}

function mergeSeed(existing,seedCards){
  const map=new Map(existing.map(c=>[cardKey(c),c]));
  seedCards.map(normalizeCard).forEach(s=>{
    const k=cardKey(s),cur=map.get(k);
    if(!cur){
      existing.push(s);map.set(k,s);return;
    }
    if(!cur.ipa&&s.ipa)cur.ipa=s.ipa;
    if(!cur.pronunciationFa&&s.pronunciationFa)cur.pronunciationFa=s.pronunciationFa;
    if(!cur.partOfSpeech&&s.partOfSpeech)cur.partOfSpeech=s.partOfSpeech;
    if(!cur.notes&&s.notes)cur.notes=s.notes;
    const have=new Set(cur.senses.map(senseKey));
    s.senses.forEach(x=>{
      if(!have.has(senseKey(x))){
        cur.senses.push(normalizeSense(x));
        have.add(senseKey(x));
      }
    });
  });
  return existing;
}

function load(){
  try{settings={...settings,...JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')}}catch(e){}
  $('accent').value=settings.accent;
  $('speechRate').value=settings.speechRate;
  $('speedLabel').textContent=settings.speechRate;
  $('autoSpeak').checked=!!settings.autoSpeak;
  $('leechThreshold').value=settings.leechThreshold;

  let stored=null;
  try{stored=JSON.parse(localStorage.getItem(DATA_KEY)||'null')}catch(e){}
  if(!Array.isArray(stored)){
    for(const key of OLD_KEYS){
      try{
        const old=JSON.parse(localStorage.getItem(key)||'null');
        if(Array.isArray(old)){stored=old;break}
      }catch(e){}
    }
  }
  if(!Array.isArray(stored))stored=[];
  cards=stored.map(normalizeCard);
  const seed=loadSeedPayload();
  cards=mergeSeed(cards,Array.isArray(seed.cards)?seed.cards:[]);
  recomputeLeeches();
  save();
  resetForm();
  refreshFilters();
  renderLibrary();
  updateStats();
}

function save(){
  localStorage.setItem(DATA_KEY,JSON.stringify(cards));
  updateStats();
}

function saveSettings(){
  settings={
    accent:$('accent').value,
    speechRate:Number($('speechRate').value),
    autoSpeak:$('autoSpeak').checked,
    leechThreshold:Math.max(3,Math.min(20,Number($('leechThreshold').value)||6))
  };
  $('leechThreshold').value=settings.leechThreshold;
  localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));
  recomputeLeeches();
  save();
}

function recomputeLeeches(){
  cards.forEach(c=>{
    c.masterReview.leech=c.masterReview.leech||c.masterReview.lapses>=settings.leechThreshold;
    c.senses.forEach(s=>s.review.leech=s.review.leech||s.review.lapses>=settings.leechThreshold);
  });
}

function showTab(id){
  ['review','add','library','io','stats'].forEach(x=>$(x).classList.toggle('hidden',x!==id));
  if(id==='library')renderLibrary();
  if(id==='stats')updateStats();
}

function updateStats(){
  const due=totalDueItems();
  const leeches=totalLeeches();
  const mastered=cards.filter(cardMastered).length;
  $('topStats').innerHTML=
    '<span class="chip">'+cards.length+' واژه</span>'+
    '<span class="chip">'+totalSenseCount()+' معنی</span>'+
    '<span class="chip">'+due+' موعد</span>'+
    (leeches?'<span class="chip leech">'+leeches+' Leech</span>':'');

  $('kpis').innerHTML=
    '<div class="kpi"><b>'+cards.length+'</b>واژه/عبارت</div>'+
    '<div class="kpi"><b>'+totalSenseCount()+'</b>Sense Card</div>'+
    '<div class="kpi"><b>'+due+'</b>موعد مرور</div>'+
    '<div class="kpi"><b>'+mastered+'</b>تسلط بالا</div>'+
    '<div class="kpi"><b>'+totalReviews()+'</b>مرور انجام‌شده</div>'+
    '<div class="kpi"><b>'+leeches+'</b>Leech</div>';

  const box=$('leechSummary');
  if(leeches){
    box.classList.remove('hidden');
    box.innerHTML='<b>⚠ '+leeches+' مورد Leech داری.</b><br>در بخش مرور، دامنه را روی «Leechها» بگذار تا فقط همین موارد را تمرین کنی.';
  }else box.classList.add('hidden');
}

function refreshFilters(){
  const lessons=[...new Set(cards.map(c=>c.lesson).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fa'));
  [$('reviewLesson'),$('listLesson')].forEach(sel=>{
    const old=sel.value;
    sel.innerHTML='<option value="">همه درس‌ها</option>'+lessons.map(x=>'<option>'+esc(x)+'</option>').join('');
    sel.value=lessons.includes(old)?old:'';
  });
}

function addSenseEditor(sense={}){
  const s=normalizeSense(sense);
  const wrap=document.createElement('div');
  wrap.className='sense-editor';
  wrap.dataset.senseId=s.id;
  wrap.dataset.review=JSON.stringify(s.review);
  wrap.innerHTML=
    '<label class="muted">معنی فارسی</label>'+
    '<input class="sMeaning" value="'+attr(s.meaning)+'" placeholder="معنی">'+
    '<label class="muted">مثال انگلیسی</label>'+
    '<textarea class="sExample" dir="ltr" placeholder="Example in English">'+esc(s.example)+'</textarea>'+
    '<label class="muted">ترجمه مثال</label>'+
    '<textarea class="sTranslation" placeholder="ترجمه فارسی مثال">'+esc(s.translation)+'</textarea>'+
    '<button class="btn danger small" type="button" onclick="this.parentElement.remove()">حذف این معنی</button>';
  $('senseEditors').appendChild(wrap);
}

function resetForm(){
  $('editId').value='';
  $('formTitle').textContent='افزودن واژه';
  $('cancelEdit').classList.add('hidden');
  $('fWord').value='';
  $('fPos').value='';
  $('fIpa').value='';
  $('fPronFa').value='';
  $('fLesson').value=DEFAULT_LESSON;
  $('fLevel').value='B2';
  $('fNotes').value='';
  $('senseEditors').innerHTML='';
  addSenseEditor();
}

function collectSenses(){
  return [...document.querySelectorAll('.sense-editor')].map(el=>{
    let review={};
    try{review=JSON.parse(el.dataset.review||'{}')}catch(e){}
    return normalizeSense({
      id:el.dataset.senseId||uid(),
      meaning:el.querySelector('.sMeaning').value.trim(),
      example:el.querySelector('.sExample').value.trim(),
      translation:el.querySelector('.sTranslation').value.trim(),
      review
    });
  }).filter(s=>s.meaning||s.example||s.translation);
}

function saveCardForm(){
  const word=$('fWord').value.trim();
  const senses=collectSenses();
  if(!word)return alert('کلمه یا عبارت را وارد کن.');
  if(!senses.length||!senses.some(s=>s.meaning))return alert('حداقل یک معنی فارسی وارد کن.');

  const id=$('editId').value;
  const data={
    word,
    ipa:$('fIpa').value.trim(),
    pronunciationFa:$('fPronFa').value.trim(),
    partOfSpeech:$('fPos').value.trim(),
    lesson:$('fLesson').value.trim()||'بدون درس',
    level:$('fLevel').value,
    notes:$('fNotes').value.trim(),
    senses,
    updatedAt:Date.now()
  };

  if(id){
    const i=cards.findIndex(c=>String(c.id)===String(id));
    if(i>=0)cards[i]=normalizeCard({...cards[i],...data,id:cards[i].id,masterReview:cards[i].masterReview});
  }else cards.unshift(normalizeCard(data));

  save();refreshFilters();resetForm();showTab('library');renderLibrary();
}

function editCard(id){
  const c=cards.find(x=>String(x.id)===String(id));if(!c)return;
  $('editId').value=c.id;
  $('formTitle').textContent='ویرایش: '+c.word;
  $('cancelEdit').classList.remove('hidden');
  $('fWord').value=c.word;
  $('fPos').value=c.partOfSpeech;
  $('fIpa').value=c.ipa;
  $('fPronFa').value=c.pronunciationFa;
  $('fLesson').value=c.lesson;
  $('fLevel').value=c.level;
  $('fNotes').value=c.notes;
  $('senseEditors').innerHTML='';
  c.senses.forEach(addSenseEditor);
  showTab('add');
  window.scrollTo({top:0,behavior:'smooth'});
}

function deleteCard(id){
  if(!confirm('این واژه و تمام سابقه مرور Master و Sense آن حذف شود؟'))return;
  cards=cards.filter(c=>String(c.id)!==String(id));
  save();refreshFilters();renderLibrary();
}

function clearCardLeech(id){
  const c=cards.find(x=>String(x.id)===String(id));if(!c)return;
  c.masterReview.leech=false;c.masterReview.lapses=0;
  c.senses.forEach(s=>{s.review.leech=false;s.review.lapses=0});
  save();renderLibrary();
}

function clearLibraryFilters(){
  $('search').value='';$('listLesson').value='';$('listLevel').value='';$('listStatus').value='';$('sortBy').value='recent';
  renderLibrary();
}

function renderLibrary(){
  if(!$('libraryItems'))return;
  const q=$('search').value.trim().toLowerCase();
  const lesson=$('listLesson').value;
  const level=$('listLevel').value;
  const status=$('listStatus').value;
  let list=cards.filter(c=>{
    if(lesson&&c.lesson!==lesson)return false;
    if(level&&c.level!==level)return false;
    if(status==='due'&&!cardIsDue(c))return false;
    if(status==='leech'&&!cardHasLeech(c))return false;
    if(status==='hard'&&!cardHasHard(c))return false;
    if(status==='mastered'&&!cardMastered(c))return false;
    if(q){
      const hay=[c.word,c.ipa,c.pronunciationFa,c.partOfSpeech,c.lesson,c.notes,...c.senses.flatMap(s=>[s.meaning,s.example,s.translation])].join(' ').toLowerCase();
      if(!hay.includes(q))return false;
    }
    return true;
  });

  const sort=$('sortBy').value;
  if(sort==='alpha')list.sort((a,b)=>a.word.localeCompare(b.word,'en'));
  else if(sort==='due')list.sort((a,b)=>(nextDueForCard(a)||0)-(nextDueForCard(b)||0));
  else if(sort==='leech')list.sort((a,b)=>Number(cardHasLeech(b))-Number(cardHasLeech(a))||b.updatedAt-a.updatedAt);
  else list.sort((a,b)=>b.updatedAt-a.updatedAt);

  $('listCount').textContent=list.length+' مورد از '+cards.length+' واژه';
  $('libraryItems').innerHTML=list.slice(0,1000).map(c=>{
    const leech=cardHasLeech(c);
    const hard=cardHasHard(c);
    const due=cardIsDue(c);
    const previews=c.senses.slice(0,3).map((s,i)=>
      '<div class="sensePreview"><b>'+(i+1)+'. '+esc(s.meaning)+'</b>'+
      (s.example?'<div class="small" dir="ltr" style="text-align:left">'+esc(s.example)+'</div>':'')+
      (s.review.leech?'<span class="chip leech">Sense Leech</span>':'')+'</div>'
    ).join('');
    return '<div class="item">'+
      '<div class="itemTop"><div><div class="itemTitle">'+esc(c.word)+'</div>'+
      '<div class="ipa">'+esc(c.ipa)+'</div>'+
      '<div class="itemMeta">'+esc(c.partOfSpeech)+' · '+esc(c.level)+' · '+esc(c.lesson)+' · '+c.senses.length+' معنی</div></div>'+
      '<div class="chips">'+
      (due?'<span class="chip">موعد</span>':'')+
      (hard?'<span class="chip">سخت</span>':'')+
      (leech?'<span class="chip leech">Leech</span>':'')+
      '</div></div>'+
      previews+
      (c.senses.length>3?'<div class="muted">+'+(c.senses.length-3)+' معنی دیگر</div>':'')+
      '<div class="actions" style="margin-top:10px">'+
      '<button class="btn primary" onclick="reviewOne(\''+jsq(c.id)+'\')">مرور این واژه</button>'+
      '<button class="btn secondary" onclick="speakCard(\''+jsq(c.id)+'\')">🔊</button>'+
      '<button class="btn secondary" onclick="editCard(\''+jsq(c.id)+'\')">ویرایش</button>'+
      (leech?'<button class="btn warning" onclick="clearCardLeech(\''+jsq(c.id)+'\')">رفع Leech</button>':'')+
      '<button class="btn danger" onclick="deleteCard(\''+jsq(c.id)+'\')">حذف</button>'+
      '</div></div>';
  }).join('')||'<div class="muted" style="padding:24px;text-align:center">موردی پیدا نشد.</div>';
}

function itemStateMatches(state,scope){
  if(scope==='all')return true;
  if(scope==='due')return stateIsDue(state);
  if(scope==='hard')return state.lastRating==='again'||state.lastRating==='hard';
  if(scope==='leech')return state.leech;
  return true;
}

function buildQueue(type,scope,lesson,onlyCardId=null){
  const out=[];
  cards.forEach(c=>{
    if(onlyCardId&&String(c.id)!==String(onlyCardId))return;
    if(lesson&&c.lesson!==lesson)return;

    if(type==='master'||type==='mixed'){
      const item={cardId:c.id,kind:'master'};
      if(itemStateMatches(c.masterReview,scope))out.push(item);
    }

    if(type!=='master'){
      c.senses.forEach((s,i)=>{
        let kind=type;
        if(type==='mixed'){
          const choices=['sense','reverse','typed'];
          kind=choices[(i+c.masterReview.reviewCount+s.review.reviewCount)%choices.length];
        }
        const item={cardId:c.id,senseId:s.id,kind};
        if(itemStateMatches(s.review,scope))out.push(item);
      });
    }
  });

  out.sort((a,b)=>{
    const sa=getReviewState(a),sb=getReviewState(b);
    if(Number(sb.leech)!==Number(sa.leech))return Number(sb.leech)-Number(sa.leech);
    const da=sa.dueAt||0,db=sb.dueAt||0;
    return da-db||Math.random()-.5;
  });
  return out;
}

function startReview(){
  const type=$('reviewType').value;
  const scope=$('reviewScope').value;
  const lesson=$('reviewLesson').value;
  queue=buildQueue(type,scope,lesson);
  queueIndex=0;
  if(!queue.length){
    $('reviewWrap').classList.add('hidden');
    $('emptyReview').classList.remove('hidden');
    $('emptyReview').textContent='برای این فیلتر فعلاً کارتی وجود ندارد.';
    return;
  }
  $('emptyReview').classList.add('hidden');
  $('reviewWrap').classList.remove('hidden');
  renderCurrent();
}

function reviewOne(cardId){
  showTab('review');
  queue=buildQueue('mixed','all','',cardId);
  queueIndex=0;
  if(queue.length){
    $('emptyReview').classList.add('hidden');
    $('reviewWrap').classList.remove('hidden');
    renderCurrent();
  }
}

function stopReview(){
  queue=[];queueIndex=0;
  $('reviewWrap').classList.add('hidden');
  $('emptyReview').classList.remove('hidden');
  $('emptyReview').textContent='مرور متوقف شد.';
}

function currentParts(){
  const item=queue[queueIndex];
  if(!item)return {};
  const card=cards.find(c=>String(c.id)===String(item.cardId));
  const sense=card&&item.senseId?getSense(card,item.senseId):null;
  const state=card?(item.kind==='master'?card.masterReview:(sense?sense.review:null)):null;
  return {item,card,sense,state};
}

function modeTitle(kind){
  return {master:'Master Card',sense:'Sense Card',reverse:'Reverse Card',typed:'Typed Answer'}[kind]||kind;
}

function clearFront(){
  $('frontWord').textContent='';$('frontWord').classList.remove('hidden');
  $('frontPersian').textContent='';$('frontPersian').classList.add('hidden');
  $('frontIpa').textContent='';$('frontPronFa').textContent='';$('frontPos').textContent='';
  $('frontPrompt').textContent='';$('frontContext').textContent='';$('frontContext').classList.add('hidden');
  $('typedBox').classList.add('hidden');$('typedFeedback').classList.add('hidden');$('typedFeedback').textContent='';
  $('typedInput').value='';
  $('answerBox').innerHTML='';$('answerBox').classList.add('hidden');
  $('ratings').classList.add('hidden');
}

function renderCurrent(){
  if(queueIndex>=queue.length){
    $('reviewWrap').classList.add('hidden');
    $('emptyReview').classList.remove('hidden');
    $('emptyReview').innerHTML='<b>مرور تمام شد.</b><br>زمان‌بندی کارت‌ها ذخیره شد.';
    updateStats();renderLibrary();return;
  }
  revealed=false;typedChecked=false;clearFront();
  const {item,card,sense,state}=currentParts();
  if(!card||!state){queueIndex++;renderCurrent();return}

  $('modeBadge').textContent=modeTitle(item.kind);
  $('leechBadge').classList.toggle('hidden',!state.leech);
  $('reviewCounter').textContent=(queueIndex+1)+' / '+queue.length;
  $('progressFill').style.width=((queueIndex/queue.length)*100)+'%';

  if(item.kind==='master'){
    $('frontWord').textContent=card.word;
    $('frontIpa').textContent=card.ipa;
    $('frontPronFa').textContent=card.pronunciationFa;
    $('frontPos').textContent=card.partOfSpeech;
    $('frontPrompt').textContent='همه معنی‌های این واژه/عبارت را به یاد بیاور.';
    $('answerBox').innerHTML=
      card.senses.map((s,i)=>'<div class="sense"><div class="meaning">'+(i+1)+'. '+esc(s.meaning)+'</div>'+
      (s.example?'<div class="example">'+esc(s.example)+'</div>':'')+
      (s.translation?'<div class="translation">'+esc(s.translation)+'</div>':'')+'</div>').join('')+
      (card.notes?'<div class="notice">'+esc(card.notes)+'</div>':'');
  }else if(item.kind==='sense'){
    $('frontWord').textContent=card.word;
    $('frontIpa').textContent=card.ipa;
    $('frontPronFa').textContent=card.pronunciationFa;
    $('frontPos').textContent=card.partOfSpeech;
    $('frontPrompt').textContent='معنی این کاربرد را بگو.';
    if(sense.example){
      $('frontContext').textContent=sense.example;
      $('frontContext').classList.remove('hidden');
    }
    $('answerBox').innerHTML='<div class="sense"><div class="meaning">'+esc(sense.meaning)+'</div>'+
      (sense.translation?'<div class="translation">'+esc(sense.translation)+'</div>':'')+'</div>';
  }else if(item.kind==='reverse'||item.kind==='typed'){
    $('frontWord').classList.add('hidden');
    $('frontPersian').classList.remove('hidden');
    $('frontPersian').textContent=sense.meaning;
    $('frontPos').textContent=card.partOfSpeech;
    $('frontPrompt').textContent=item.kind==='typed'?'کلمه/عبارت انگلیسی را تایپ کن.':'معادل انگلیسی را به یاد بیاور.';
    if(sense.translation){
      $('frontContext').textContent=sense.translation;
      $('frontContext').classList.remove('hidden');
    }
    $('answerBox').innerHTML='<div class="word">'+esc(card.word)+'</div>'+
      (card.ipa?'<div class="ipa">'+esc(card.ipa)+'</div>':'')+
      (card.pronunciationFa?'<div class="pronfa">'+esc(card.pronunciationFa)+'</div>':'')+
      (sense.example?'<div class="example">'+esc(sense.example)+'</div>':'')+
      (sense.translation?'<div class="translation">'+esc(sense.translation)+'</div>':'');
    if(item.kind==='typed'){
      $('typedBox').classList.remove('hidden');
      setTimeout(()=>$('typedInput').focus(),120);
    }
  }

  if(settings.autoSpeak&&(item.kind==='master'||item.kind==='sense'))speak(card.word,settings.accent);
}

function revealCurrent(){
  const {item}=currentParts();
  if(!item)return;
  if(item.kind==='typed'&&!typedChecked)return;
  revealed=true;
  $('answerBox').classList.remove('hidden');
  $('ratings').classList.remove('hidden');
}

function normalizeAnswer(s){
  return String(s||'').toLowerCase().trim()
    .replace(/[’']/g,"'")
    .replace(/[^a-z0-9' -]/g,'')
    .replace(/\s+/g,' ');
}

function levenshtein(a,b){
  if(a===b)return 0;
  if(!a.length)return b.length;if(!b.length)return a.length;
  const prev=Array.from({length:b.length+1},(_,i)=>i);
  const cur=new Array(b.length+1);
  for(let i=1;i<=a.length;i++){
    cur[0]=i;
    for(let j=1;j<=b.length;j++){
      cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
    }
    for(let j=0;j<=b.length;j++)prev[j]=cur[j];
  }
  return prev[b.length];
}

function checkTypedAnswer(){
  const {card}=currentParts();if(!card)return;
  const got=normalizeAnswer($('typedInput').value);
  const expected=normalizeAnswer(card.word);
  if(!got)return;
  const d=levenshtein(got,expected);
  const allowance=expected.length<=5?0:expected.length<=10?1:2;
  const fb=$('typedFeedback');
  fb.classList.remove('hidden','ok','close','bad');
  if(got===expected){
    fb.classList.add('ok');fb.textContent='✓ درست';
  }else if(d<=allowance){
    fb.classList.add('close');fb.textContent='تقریباً درست — فاصله تایپی: '+d;
  }else{
    fb.classList.add('bad');fb.textContent='✕ نادرست — جواب صحیح پایین نمایش داده شد.';
  }
  typedChecked=true;revealed=true;
  $('answerBox').classList.remove('hidden');
  $('ratings').classList.remove('hidden');
}

function giveUpTyped(){
  const fb=$('typedFeedback');
  fb.classList.remove('hidden','ok','close');fb.classList.add('bad');
  fb.textContent='جواب نمایش داده شد؛ بهتر است «دوباره» یا «سخت» را انتخاب کنی.';
  typedChecked=true;revealed=true;
  $('answerBox').classList.remove('hidden');
  $('ratings').classList.remove('hidden');
}

$('typedInput').addEventListener('keydown',e=>{if(e.key==='Enter')checkTypedAnswer()});

function scheduleState(state,rating){
  const t=now();
  const intervals=[0,1,3,7,14,30,60,120,240,365];
  state.reviewCount++;
  state.lastRating=rating;
  state.lastReviewedAt=t;

  if(rating==='again'){
    state.stage=Math.max(0,state.stage-1);
    state.missedCount++;
    state.lapses++;
    state.dueAt=t+10*60*1000;
  }else if(rating==='hard'){
    state.missedCount++;
    state.dueAt=t+8*60*60*1000;
  }else if(rating==='good'){
    state.knownCount++;
    state.stage=Math.min(state.stage+1,9);
    state.dueAt=t+(intervals[state.stage]||365)*86400000;
  }else if(rating==='easy'){
    state.knownCount++;
    state.stage=Math.min(state.stage+2,9);
    state.dueAt=t+(intervals[state.stage]||365)*86400000;
  }
  if(state.lapses>=settings.leechThreshold)state.leech=true;
}

function rateCurrent(rating){
  if(!revealed){
    revealCurrent();
    return;
  }
  const {state}=currentParts();if(!state)return;
  scheduleState(state,rating);
  save();
  queueIndex++;
  renderCurrent();
}

function speak(text,locale=settings.accent){
  if(!text)return;
  const rate=Number(settings.speechRate)||0.85;
  if(window.Android&&Android.speak){
    Android.speak(text,locale,rate);
  }else if('speechSynthesis'in window){
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);u.lang=locale;u.rate=rate;speechSynthesis.speak(u);
  }
}
function speakCurrent(locale){
  const {card}=currentParts();if(card)speak(card.word,locale);
}
function speakCurrentExample(){
  const {card,sense,item}=currentParts();
  if(!card)return;
  const ex=item.kind==='master'?(card.senses.find(s=>s.example)||{}).example:(sense?sense.example:'');
  if(ex)speak(ex,settings.accent);
}
function speakCard(id){
  const c=cards.find(x=>String(x.id)===String(id));if(c)speak(c.word);
}
function openTtsSettings(){
  if(window.Android&&Android.openTtsSettings)Android.openTtsSettings();
}

function flattenRows(){
  const rows=[];
  cards.forEach(c=>c.senses.forEach((s,i)=>rows.push({
    word:c.word,ipa:c.ipa,pronunciation_fa:c.pronunciationFa,part_of_speech:c.partOfSpeech,
    meaning_fa:s.meaning,example_en:s.example,example_fa:s.translation,
    lesson:c.lesson,level:c.level,sense_order:String(i+1),notes:c.notes
  })));
  return rows;
}

function importRows(rows){
  if(!Array.isArray(rows))throw new Error('rows');
  const clean=rows.map((r,i)=>({...r,_order:Number(r.sense_order||i+1)})).filter(r=>String(r.word||'').trim()&&String(r.meaning_fa||'').trim());
  clean.sort((a,b)=>a._order-b._order);

  const grouped=new Map();
  clean.forEach(r=>{
    const word=String(r.word||'').trim();
    const lesson=String(r.lesson||'بدون درس').trim();
    const key=word.toLowerCase()+'|'+lesson.toLowerCase();
    if(!grouped.has(key))grouped.set(key,{
      word,
      ipa:String(r.ipa||'').trim(),
      pronunciationFa:String(r.pronunciation_fa||'').trim(),
      partOfSpeech:String(r.part_of_speech||'').trim(),
      lesson,
      level:String(r.level||'B2').trim()||'B2',
      notes:String(r.notes||'').trim(),
      senses:[]
    });
    grouped.get(key).senses.push(normalizeSense({
      meaning:String(r.meaning_fa||'').trim(),
      example:String(r.example_en||'').trim(),
      translation:String(r.example_fa||'').trim()
    }));
  });

  let added=0,merged=0;
  const map=new Map(cards.map(c=>[cardKey(c),c]));
  grouped.forEach(g=>{
    const key=cardKey(g),cur=map.get(key);
    if(!cur){
      const n=normalizeCard(g);cards.unshift(n);map.set(key,n);added++;
    }else{
      if(!cur.ipa&&g.ipa)cur.ipa=g.ipa;
      if(!cur.pronunciationFa&&g.pronunciationFa)cur.pronunciationFa=g.pronunciationFa;
      if(!cur.partOfSpeech&&g.partOfSpeech)cur.partOfSpeech=g.partOfSpeech;
      if(!cur.notes&&g.notes)cur.notes=g.notes;
      const have=new Set(cur.senses.map(senseKey));
      g.senses.forEach(s=>{
        if(!have.has(senseKey(s))){cur.senses.push(s);have.add(senseKey(s));merged++}
      });
      cur.updatedAt=Date.now();
    }
  });
  save();refreshFilters();renderLibrary();
  alert(added+' واژه جدید و '+merged+' معنی جدید اضافه شد.');
}

function importExcel(){
  if(window.Android&&Android.pickExcel)Android.pickExcel();
  else alert('ورود مستقیم Excel فقط در نسخه Android فعال است.');
}
window.onExcelImportedFromJson=function(json){
  try{importRows(JSON.parse(json))}
  catch(e){alert('ساختار Excel معتبر نیست. مطمئن شو شیت اول دارای هدر استاندارد اپ است.')}
};
function exportExcel(){
  if(window.Android&&Android.exportXlsx)Android.exportXlsx(JSON.stringify(flattenRows()),'vocabulary-export.xlsx');
  else alert('این قابلیت در نسخه Android فعال است.');
}
function downloadExcelTemplate(){
  if(window.Android&&Android.exportXlsx)Android.exportXlsx('[]','vocabulary-template.xlsx');
}
function parseTSV(txt){
  const lines=String(txt||'').replace(/\r/g,'').split('\n').filter(x=>x.trim());
  if(lines.length<2)return[];
  const headers=lines[0].split('\t').map(x=>x.trim());
  return lines.slice(1).map(line=>{
    const vals=line.split('\t'),o={};
    headers.forEach((h,i)=>o[h]=vals[i]??'');
    return o;
  });
}
function importTSV(){
  try{
    const rows=parseTSV($('tsvInput').value);
    if(!rows.length)return alert('داده‌ای پیدا نشد. هدر استاندارد و ردیف‌ها را کامل Paste کن.');
    importRows(rows);$('tsvInput').value='';
  }catch(e){alert('فرمت TSV معتبر نیست.')}
}
function copyHeader(){
  const h=HEADER.join('\t');
  $('tsvInput').value=h+'\n';
  try{navigator.clipboard&&navigator.clipboard.writeText(h)}catch(e){}
}
function exportJson(){
  const payload={version:4,exportedAt:new Date().toISOString(),settings,cards};
  const txt=JSON.stringify(payload,null,2);
  if(window.Android&&Android.saveFile)Android.saveFile('vocab-backup-v4.json',txt,'application/json');
}
function importJson(file){
  if(!file)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const d=JSON.parse(r.result);
      const arr=Array.isArray(d)?d:d.cards;
      if(!Array.isArray(arr))throw new Error('format');
      cards=arr.map(normalizeCard);
      if(d.settings)settings={...settings,...d.settings};
      save();refreshFilters();renderLibrary();updateStats();
      alert('پشتیبان با موفقیت بازیابی شد.');
    }catch(e){alert('فایل JSON معتبر نیست.')}
  };
  r.readAsText(file);
}

function resetProgress(){
  if(!confirm('فقط سابقه مرور پاک شود؟ واژه‌ها، معنی‌ها و مثال‌ها باقی می‌مانند.'))return;
  cards.forEach(c=>{
    c.masterReview=blankReview();
    c.senses.forEach(s=>s.review=blankReview());
  });
  save();renderLibrary();alert('سابقه مرور پاک شد.');
}

load();
