const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {MongoMemoryServer}=require('mongodb-memory-server');
const back=path.resolve(__dirname, '..');
const front=process.env.FRONTEND_TEST_DIR || path.resolve(back, '../canchalibre-frontend');
const {chromium}=require(path.join(front, 'node_modules/playwright'));
(async()=>{
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'},instance:{dbName:'canchalibre_test',args:['--nounixsocket']}});
 let api,browser,web;const mongoose=require(back+'/node_modules/mongoose');
 try{
  let apiBase;
  web=http.createServer((req,res)=>{const file=path.join(front,decodeURIComponent(req.url.split('?')[0]));try{let body=fs.readFileSync(file);if(file.endsWith('/config.js'))body=Buffer.from('window.API_BASE_URL='+JSON.stringify(apiBase)+';\n'+body);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);}catch{res.writeHead(404).end();}});
  await new Promise(r=>web.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+web.address().port;
  Object.assign(process.env,{MONGO_URI:mongo.getUri('canchalibre_test'),JWT_SECRET:'web-test-secret',JWT_ACCESS_SECRET:'web-test-secret',NODE_ENV:'test',FRONT_URL:origin,ALLOWED_ORIGINS:origin,MP_ACCESS_TOKEN:'TEST-local'});
  const express=require(back+'/node_modules/express'),cron=require(back+'/node_modules/node-cron');
  const originalListen=express.application.listen;express.application.listen=function(){api=originalListen.call(this,0,'127.0.0.1');return api;};cron.schedule=()=>({stop(){}});
  const email= require.resolve(back+'/utils/email');require.cache[email]={id:email,filename:email,loaded:true,exports:{sendMail:async()=>{}}};
  require(back+'/server');await mongoose.connection.asPromise();if(!api.listening)await new Promise(r=>api.once('listening',r));apiBase='http://127.0.0.1:'+api.address().port;
  const Usuario=require(back+'/models/Usuario'),Club=require(back+'/models/Club'),Cancha=require(back+'/models/Cancha'),Reserva=require(back+'/models/Reserva');
  const hash=await require(back+'/node_modules/bcryptjs').hash('Web-test-123!',4);
  const user=await Usuario.create({email:'web@example.com',nombre:'Prueba',apellido:'Web',telefono:'123',passwordHash:hash,emailVerificado:true});
  await Club.create({email:'club@example.com',nombre:'Club Web',passwordHash:hash,telefono:'123',provincia:'Cordoba',localidad:'Test'});
  const cancha=await Cancha.create({clubEmail:'club@example.com',nombre:'Cancha Web',deporte:'padel',precio:1000,horaDesde:'08:00',horaHasta:'22:00',diasDisponibles:['jueves'],duracionTurno:60});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,args:process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [],headless:true});
  const context=await browser.newContext();await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin||u.origin===apiBase)return route.continue();return route.fulfill({status:200,body:'',contentType:'text/javascript'});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(origin+'/login.html');await page.fill('#email',user.email);await page.fill('#password','Web-test-123!');await page.click('#form-login button[type="submit"]');await page.waitForURL(origin+'/index.html');
  await page.waitForFunction(()=>document.getElementById('usuario-logueado').textContent==='web@example.com');
  const cookies=await context.cookies(apiBase+'/auth/refresh');const refresh=cookies.find(c=>c.name==='canchalibre_refresh');assert.ok(refresh);assert.equal(refresh.httpOnly,true);assert.equal(refresh.path,'/auth');
  await page.goto(origin+'/panel-usuario.html');await page.waitForFunction(()=>document.getElementById('nombre').value==='Prueba');await page.click('#btn-editar');await page.fill('#nombre','Actualizado');await page.click('#btn-guardar');await page.waitForFunction(()=>document.getElementById('nombre').value==='Actualizado'&&document.getElementById('nombre').disabled);assert.equal((await Usuario.findById(user._id)).nombre,'Actualizado');
  await page.evaluate(data=>localStorage.setItem('turnoSeleccionado',JSON.stringify(data)),{canchaId:String(cancha._id),club:'club@example.com',deporte:'padel',fecha:'2030-01-10',hora:'10:00',precio:1000,duracionTurno:60});
  await page.goto(origin+'/detalle.html');await page.waitForFunction(()=>document.getElementById('detalle').textContent.includes('Club Web'));await page.click('#confirmar-reserva');await page.waitForURL(origin+'/index.html');
  const pending=await Reserva.findOne({usuarioId:user._id,estado:'PENDING'});assert.ok(pending);await page.goto(origin+'/confirmar-reserva.html?id='+pending._id+'&code='+pending.codigoOTP);await page.waitForURL(origin+'/reserva-confirmada.html?id='+pending._id);assert.equal((await Reserva.findById(pending._id)).estado,'CONFIRMED');
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>document.getElementById('logout').style.display==='inline');await page.click('#logout');await page.waitForURL(origin+'/login.html');
  assert.equal((await context.cookies(apiBase+'/auth/refresh')).some(c=>c.name==='canchalibre_refresh'),false);assert.deepEqual(errors,[]);
  console.log('E2E real OK: login, cookie HttpOnly, refresh entre páginas, editar perfil, hold, OTP, confirmación y logout; MongoDB aislado, correo simulado, sin producción.');
 }finally{if(browser)await browser.close();if(api)await new Promise(r=>api.close(r));if(web)await new Promise(r=>web.close(r));await mongoose.disconnect();await mongo.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
