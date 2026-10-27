/* Online dictionary — independent of local vocabulary and Excel import. */
const onlineState = {
  requestId:'',word:'',ipa:'',senses:[],images:[],selectedImage:-1,frequency:[],
  sourceUrl:'',ngramUrl:'',statuses:{dictionary:'',frequency:'',image:''}
};
function onlineEsc(x){return esc(x==null?'':String(x))}
function onlineAttr(x){return attr(x==null?'':String(x))}
function openOnlineWord(word){
  showTab('online');
  $('onlineInput').value=word;
  searchOnline();
}
function searchOnline(){
  const word=$('onlineInput').value.trim().replace(/\s+/g,' ');
  if(!word)return alert('واژه یا عبارت انگلیسی را وارد کن.');
  if(word.length>90)return alert('عبارت بیش از حد طولانی است.');
  onlineState.requestId=uid();
  onlineState.word=word;onlineState.ipa='';onlineState.senses=[];onlineState.images=[];
  onlineState.selectedImage=-1;onlineState.frequency=[];
  onlineState.sourceUrl='';onlineState.ngramUrl='';
  onlineState.statuses={dictionary:'در حال دریافت معنی‌ها',frequency:'در حال دریافت نمودار',image:'در حال جست‌وجوی تصویر'};
  $('onlineResults').classList.add('hidden');
  $('onlineFrequencyPanel').classList.add('hidden');
  $('onlineImagePanel').classList.add('hidden');
  $('onlineSenses').innerHTML='';
  renderOnlineStatus();
  if(window.Android&&Android.lookupOnline){
    Android.lookupOnline(word,onlineState.requestId);
  }else{
    onlineState.statuses.dictionary='جست‌وجوی آنلاین به نسخه اندروید و اتصال اینترنت نیاز دارد.';
    onlineState.statuses.frequency='';
    onlineState.statuses.image='';
    renderOnlineStatus();
  }
}
function renderOnlineStatus(){
  $('onlineStatus').textContent=Object.values(onlineState.statuses).filter(Boolean).join(' · ')||'پایان جست‌وجو';
}
window.onOnlineLookupResult=function(json){
  let data;
  try{data=JSON.parse(json)}catch(e){return}
  if(data.requestId!==onlineState.requestId)return;
  const type=data.type;
  if(data.error){
    onlineState.statuses[type]=data.error;
    renderOnlineStatus();
    return;
  }
  if(type==='dictionary'){
    onlineState.word=data.word||onlineState.word;
    onlineState.ipa=data.ipa||'';
    onlineState.senses=Array.isArray(data.senses)?data.senses:[];
    onlineState.sourceUrl=data.sourceUrl||'';
    $('onlineResults').classList.remove('hidden');
    $('onlineWord').textContent=onlineState.word;
    $('onlineIpa').textContent=onlineState.ipa||'تلفظ IPA در این منبع ثبت نشده است';
    $('onlineSenseCount').textContent=onlineState.senses.length+' معنی / کاربرد از '+(data.source||'منبع آنلاین')+
      (data.limited?' (حداکثر ۲۴ معنی، بقیه در منبع)':'');
    onlineState.statuses.dictionary='معنی‌ها دریافت شدند؛ ترجمه فارسی در حال تکمیل است';
    renderOnlineSenses();
  }else if(type==='translation'){
    const s=onlineState.senses[data.index];
    if(!s)return;
    if(data.meaningFa)s.meaningFa=data.meaningFa;
    if(data.exampleFa)s.exampleFa=data.exampleFa;
    const meaning=$('onlineFa-'+data.index);
    const trans=$('onlineExFa-'+data.index);
    if(meaning)meaning.textContent=s.meaningFa||'ترجمه فارسی یافت نشد.';
    if(trans)trans.textContent=s.exampleFa||'ترجمه مثال یافت نشد.';
  }else if(type==='frequency'){
    onlineState.frequency=Array.isArray(data.points)?data.points:[];
    onlineState.ngramUrl=data.sourceUrl||'';
    onlineState.statuses.frequency=onlineState.frequency.length?'نمودار تاریخی آماده است':'نمودار در دسترس نیست';
    renderOnlineFrequency();
  }else if(type==='image'){
    onlineState.images=Array.isArray(data.images)?data.images:[];
    onlineState.selectedImage=onlineState.images.length?0:-1;
    onlineState.statuses.image=onlineState.images.length?'تصویرها آماده‌اند':'تصویر مناسبی یافت نشد';
    renderOnlineImages();
  }
  renderOnlineStatus();
};
function renderOnlineSenses(){
  $('onlineSenses').innerHTML=onlineState.senses.map((s,i)=>
    '<div class="item">'+
    '<div class="itemTop"><span class="chip">'+(i+1)+'</span><span class="chip">'+onlineEsc(s.pos||'')+'</span></div>'+
    '<div class="meaning" id="onlineFa-'+i+'">'+onlineEsc(s.meaningFa||'در حال دریافت ترجمه فارسی...')+'</div>'+
    '<div class="example" style="font-size:14px;color:#bfdbfe">'+onlineEsc(s.definition||'')+'</div>'+
    (s.example
      ? '<div class="example">'+onlineEsc(s.example)+'</div>'+
        '<div class="translation" id="onlineExFa-'+i+'">'+onlineEsc(s.exampleFa||'در حال دریافت ترجمه مثال...')+'</div>'
      : '<div class="muted" style="margin-top:7px">این منبع برای این معنی مثال مستند جداگانه ندارد.</div>')+
    '<button class="btn secondary small" style="margin-top:9px" onclick="saveOnlineSense('+i+')">+ ذخیره همین معنی</button>'+
    '</div>'
  ).join('');
}
function onlineFrequencyPercent(v){
  return Number(v||0).toFixed(7).replace(/0+$/,'').replace(/\.$/,'')+'٪';
}
function renderOnlineFrequency(){
  const p=onlineState.frequency.filter(x=>Number.isFinite(Number(x.percent)));
  if(!p.length)return;
  $('onlineFrequencyPanel').classList.remove('hidden');
  const width=650,height=240,left=63,right=14,top=18,bottom=35;
  const plotW=width-left-right,plotH=height-top-bottom;
  const minYear=Math.min(...p.map(x=>x.year)),maxYear=Math.max(...p.map(x=>x.year));
  const maxV=Math.max(...p.map(x=>Number(x.percent)),1e-10);
  const xOf=y=>left+(y-minYear)/Math.max(1,maxYear-minYear)*plotW;
  const yOf=v=>top+plotH-(Number(v)/maxV)*plotH;
  const grid=[0,.25,.5,.75,1].map(frac=>{
    const y=top+plotH*(1-frac);
    const value=maxV*frac;
    return '<line x1="'+left+'" x2="'+(width-right)+'" y1="'+y+'" y2="'+y+'" stroke="#344860" stroke-dasharray="3 5"/>'+
      '<text x="'+(left-6)+'" y="'+(y+4)+'" text-anchor="end" fill="#a7bbd2" font-size="10">'+onlineFrequencyPercent(value)+'</text>';
  }).join('');
  const ticks=[1950,1960,1970,1980,1990,2000,2010,2019]
    .filter(y=>y>=minYear&&y<=maxYear)
    .map(y=>'<text x="'+xOf(y)+'" y="'+(height-10)+'" text-anchor="middle" fill="#a7bbd2" font-size="11">'+y+'</text>').join('');
  const pts=p.map(x=>xOf(x.year).toFixed(1)+','+yOf(x.percent).toFixed(1)).join(' ');
  $('onlineChart').innerHTML='<svg viewBox="0 0 '+width+' '+height+'" width="100%" role="img" '+
    'aria-label="نمودار درصد فراوانی تاریخی واژه در کتاب‌های انگلیسی" style="direction:ltr;max-height:280px">'+
    grid+'<polyline fill="none" stroke="#60a5fa" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="'+pts+'"/>'+
    ticks+'</svg>';
  const first=p[0],last=p[p.length-1],change=Number(first.percent)>0
    ? ((last.percent-first.percent)/first.percent)*100:null;
  $('onlineFrequencySummary').textContent=
    'سال '+first.year+': '+onlineFrequencyPercent(first.percent)+
    '  |  سال '+last.year+': '+onlineFrequencyPercent(last.percent)+
    (change===null?'':'  |  تغییر نسبی: '+(change>=0?'+':'')+change.toFixed(1)+'٪');
}
function allowedImage(url){
  return typeof url==='string'&&url.startsWith('https://upload.wikimedia.org/');
}
function renderOnlineImages(){
  const imgs=onlineState.images.filter(x=>allowedImage(x.url));
  if(!imgs.length)return;
  $('onlineImagePanel').classList.remove('hidden');
  $('onlineImages').innerHTML=imgs.map((im,i)=>
    '<button class="onlineImageChoice '+(i===onlineState.selectedImage?'selected':'')+
    '" onclick="selectOnlineImage('+i+')" title="انتخاب تصویر برای فلش‌کارت">'+
    '<img src="'+onlineAttr(im.url)+'" alt="'+onlineAttr(im.title)+'" loading="lazy">'+
    '<span>'+onlineEsc(im.title.replace(/^File:/,''))+'</span>'+
    '<span class="muted">'+onlineEsc(im.license||'مجوز را در صفحه منبع بررسی کن')+'</span>'+
    '</button>'
  ).join('');
}
function selectOnlineImage(index){
  onlineState.selectedImage=index;
  renderOnlineImages();
}
function speakOnline(){
  if(onlineState.word)speak(onlineState.word,settings.accent);
}
function openLinkOnline(url){
  if(!url||!url.startsWith('https://'))return;
  if(window.Android&&Android.openExternal)Android.openExternal(url);
  else window.open(url,'_blank','noopener');
}
function openOnlineSource(){
  const url=onlineState.sourceUrl||
    'https://en.wiktionary.org/wiki/'+encodeURIComponent(onlineState.word);
  openLinkOnline(url);
}
function openNgramSource(){
  const url=onlineState.ngramUrl||
    'https://books.google.com/ngrams/graph?content='+encodeURIComponent(onlineState.word)+
    '&year_start=1950&year_end=2019&corpus=26&smoothing=0';
  openLinkOnline(url);
}
function imageChoice(){
  if(onlineState.selectedImage<0)return null;
  return onlineState.images[onlineState.selectedImage]||null;
}
function saveOnlineToFlashcards(){
  if(!onlineState.senses.length)return alert('هنوز معنی‌ای برای ذخیره دریافت نشده است.');
  saveOnlineItems(onlineState.senses);
}
function saveOnlineSense(index){
  const sense=onlineState.senses[index];
  if(!sense)return;
  saveOnlineItems([sense]);
}
function saveOnlineItems(input){
  const word=onlineState.word.trim();
  if(!word)return;
  const lesson='جست‌وجوی آنلاین';
  let c=cards.find(x=>x.word.toLowerCase()===word.toLowerCase()&&x.lesson===lesson);
  let added=0;
  const items=input.map(s=>normalizeSense({
    meaning:(s.meaningFa||s.definition||'').trim(),
    example:(s.example||'').trim(),
    translation:(s.exampleFa||'').trim()
  })).filter(x=>x.meaning);
  if(!items.length)return alert('هنوز معنی قابل ذخیره‌ای وجود ندارد.');
  const image=imageChoice();
  if(!c){
    c=normalizeCard({
      word,ipa:onlineState.ipa,
      partOfSpeech:[...new Set(input.map(s=>s.pos).filter(Boolean))].join(' / '),
      pronunciationFa:'',lesson,level:'B2',
      notes:'منبع: '+(onlineState.sourceUrl||'Online Dictionary')+' — معنی‌های فارسی ترجمه ماشینی‌اند و نیاز به بازبینی دارند.',
      senses:items,
      imageUrl:image&&allowedImage(image.url)?image.url:'',
      imageSource:image?image.sourceUrl:''
    });
    cards.unshift(c);added=items.length;
  }else{
    const keys=new Set(c.senses.map(senseKey));
    items.forEach(s=>{
      if(!keys.has(senseKey(s))){c.senses.push(s);keys.add(senseKey(s));added++;}
    });
    if(image&&allowedImage(image.url)){
      c.imageUrl=image.url;
      c.imageSource=image.sourceUrl||'';
    }
    if(!c.ipa&&onlineState.ipa)c.ipa=onlineState.ipa;
    c.updatedAt=Date.now();
  }
  save();refreshFilters();renderLibrary();
  alert('ذخیره شد: '+added+' معنی جدید. تصویر انتخاب‌شده نیز به کارت اضافه شد، اگر موجود بود.');
}
