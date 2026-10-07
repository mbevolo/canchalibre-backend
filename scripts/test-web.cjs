const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const back=path.resolve(__dirname, '..');
const front=process.env.FRONTEND_TEST_DIR || path.resolve(back, '../canchalibre-frontend');
const {chromium}=require(path.join(front, 'node_modules/playwright'));
(async()=>{
 const mongo=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1,dbName:'canchalibre_test',storageEngine:'wiredTiger'},instanceOpts:[{args:['--nounixsocket']}]});
 let api,browser,web;const mongoose=require(back+'/node_modules/mongoose');
 try{
  let apiBase;
  web=http.createServer((req,res)=>{const file=path.join(front,decodeURIComponent(req.url.split('?')[0]));try{let body=fs.readFileSync(file);if(file.endsWith('/config.js'))body=Buffer.from('window.API_BASE_URL='+JSON.stringify(apiBase)+';\n'+body);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);}catch{res.writeHead(404).end();}});
  await new Promise(r=>web.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+web.address().port;
  Object.assign(process.env,{MONGO_URI:mongo.getUri('canchalibre_test'),JWT_SECRET:'web-test-secret',JWT_ACCESS_SECRET:'web-test-secret',NODE_ENV:'test',FRONT_URL:origin,ALLOWED_ORIGINS:origin,MP_ACCESS_TOKEN:'TEST-local'});
  const express=require(back+'/node_modules/express'),cron=require(back+'/node_modules/node-cron');
  const originalListen=express.application.listen;express.application.listen=function(){api=originalListen.call(this,0,'127.0.0.1');return api;};cron.schedule=()=>({stop(){}});
  const email= require.resolve(back+'/utils/email');require.cache[email]={id:email,filename:email,loaded:true,exports:{sendMail:async()=>{}}};
  await require(back+'/server').startServer();await mongoose.connection.asPromise();if(!api.listening)await new Promise(r=>api.once('listening',r));apiBase='http://127.0.0.1:'+api.address().port;
  const Usuario=require(back+'/models/Usuario'),Club=require(back+'/models/Club'),Cancha=require(back+'/models/Cancha'),Reserva=require(back+'/models/Reserva');
  const hash=await require(back+'/node_modules/bcryptjs').hash('Web-test-123!',4);
  const user=await Usuario.create({email:'web@example.com',nombre:'Prueba',apellido:'Web',telefono:'123',passwordHash:hash,emailVerificado:true});
  const club=await Club.create({email:'club@example.com',nombre:'Club Web',passwordHash:hash,emailVerificado:true,telefono:'123',provincia:'Cordoba',localidad:'Test'});
  const Superadmin=require(back+'/models/Superadmin');await Superadmin.create({email:'admin@example.com',nombre:'Web Admin',passwordHash:hash});
  const cancha=await Cancha.create({clubEmail:'club@example.com',nombre:'Cancha Web <img src=x onerror=window.clubInjection=true>',deporte:'padel',precio:1000,horaDesde:'08:00',horaHasta:'22:00',diasDisponibles:['jueves'],duracionTurno:60});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,args:process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [],headless:true});
  const assets = [
    ['bootstrap.bundle.min.js','bootstrap/dist/js/bootstrap.bundle.min.js'],['bootstrap.min.css','bootstrap/dist/css/bootstrap.min.css'],
    ['leaflet.js','leaflet/dist/leaflet.js'],['leaflet.css','leaflet/dist/leaflet.css'],
    ['fullcalendar@6.1.8/index.global.min.js','fullcalendar/index.global.min.js'],['qrcode.min.js','qrcodejs/qrcode.min.js'],
    ['chart.umd.min.js','chart.js/dist/chart.umd.js'],['/npm/chart.js','chart.js/dist/chart.umd.js']
  ];
  const context=await browser.newContext();await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin||u.origin===apiBase)return route.continue();const asset=assets.find(([match])=>u.pathname.endsWith(match));if(asset)return route.fulfill({status:200,body:fs.readFileSync(path.join(front,'node_modules',asset[1])),contentType:asset[1].endsWith('.css')?'text/css':'text/javascript'});return route.fulfill({status:200,body:'',contentType:'text/javascript'});});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());return d.accept();});
  await page.goto(origin+'/login.html');await page.fill('#email',user.email);await page.fill('#password','Web-test-123!');await page.click('#form-login button[type="submit"]');await page.waitForURL(origin+'/index.html');
  await page.waitForFunction(()=>document.getElementById('usuario-logueado').textContent==='web@example.com');
  const cookies=await context.cookies(apiBase+'/auth/refresh');const refresh=cookies.find(c=>c.name==='canchalibre_refresh');assert.ok(refresh);assert.equal(refresh.httpOnly,true);assert.equal(refresh.path,'/auth');
  await page.goto(origin+'/panel-usuario.html');await page.waitForFunction(()=>document.getElementById('nombre').value==='Prueba');await page.click('#btn-editar');await page.fill('#nombre','Actualizado');await page.click('#btn-guardar');await page.waitForFunction(()=>document.getElementById('nombre').value==='Actualizado'&&document.getElementById('nombre').disabled);assert.equal((await Usuario.findById(user._id)).nombre,'Actualizado');
  await page.evaluate(data=>localStorage.setItem('turnoSeleccionado',JSON.stringify(data)),{canchaId:String(cancha._id),club:'club@example.com',deporte:'padel',fecha:'2030-01-10',hora:'10:00',precio:1000,duracionTurno:60});
  await page.goto(origin+'/detalle.html');await page.waitForFunction(()=>document.getElementById('detalle').textContent.includes('Club Web'));await page.click('#confirmar-reserva');await page.waitForURL(origin+'/index.html');
  const pending=await Reserva.findOne({usuarioId:user._id,estado:'PENDING'});assert.ok(pending);await page.goto(origin+'/confirmar-reserva.html?id='+pending._id+'&code='+pending.codigoOTP);await page.waitForURL(origin+'/reserva-confirmada.html?id='+pending._id);assert.equal((await Reserva.findById(pending._id)).estado,'CONFIRMED');
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>document.getElementById('logout').style.display==='inline');await page.click('#logout');await page.waitForURL(origin+'/login.html');
  assert.equal((await context.cookies(apiBase+'/auth/refresh')).some(c=>c.name==='canchalibre_refresh'),false);assert.deepEqual(errors,[]);
  await page.goto(origin+'/login-superadmin.html');await page.fill('#email','admin@example.com');await page.fill('#password','Web-test-123!');await page.click('#btnLogin');await page.waitForURL(origin+'/superadmin.html');
  await page.click('[data-section="clubes"]');await page.waitForSelector('.club-nombre',{state:'attached'});
  const unsafeName='Club <img src=x onerror="window.adminInjection=true">';
  await Club.updateOne({_id:club._id},{$set:{nombre:unsafeName}});
  await page.click('[data-section="usuarios"]');await page.waitForSelector('.usuario-nombre',{state:'attached'});
  await page.click('[data-section="clubes"]');await page.waitForFunction(value=>document.querySelector('.club-nombre')?.value===value,unsafeName);
  assert.equal(await page.evaluate(()=>window.adminInjection),undefined);
  await page.locator('.admin-edit-record').first().click();
  await page.fill('.club-nombre','Cambio sin guardar');
  await page.locator('.admin-cancel-edit:visible').click();
  assert.equal(await page.locator('.club-nombre').inputValue(),unsafeName);
  await page.locator('.admin-edit-record').first().click();
  await page.fill('.club-nombre','Club Editado');
  await Promise.all([page.waitForResponse(r=>r.url().includes('/superadmin/clubes/')&&r.request().method()==='PUT'),page.click('.editar-club')]);
  assert.equal((await Club.findById(club._id)).nombre,'Club Editado');
  await page.click('[data-section="config"]');await page.waitForSelector('#precioDestacado');await page.fill('#precioDestacado','2750');await page.fill('#diasDestacado','10');await page.click('#form-config button');await page.waitForFunction(()=>document.getElementById('config-alerta').textContent.includes('actualizada'));
  const config=await require(back+'/models/config').findOne();assert.equal(config.precioDestacado,2750);assert.equal(config.diasDestacado,10);
  for(const section of ['usuarios','reservas','pagos','destacados']){
    await Promise.all([page.waitForResponse(r=>r.url()===apiBase+'/superadmin/'+section),page.click('[data-section="'+section+'"]')]);
    await page.waitForFunction(()=>!document.getElementById('superadmin-content').textContent.includes('Cargando'));
    assert.ok(!await page.locator('#superadmin-content').textContent().then(t=>t.includes('Error:')));
  }
  const artifacts = path.join(front, '.test-artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({path:path.join(artifacts,'panel-admin-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(artifacts,'panel-admin-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.click('#cerrar-sesion');await page.waitForURL(origin+'/login-superadmin.html');assert.equal(await page.evaluate(()=>localStorage.getItem('superadminToken')),null);assert.deepEqual(errors,[]);
  await page.goto(origin+'/login-club.html');await page.fill('#email',club.email);await page.fill('#password','Web-test-123!');await page.click('#form-login-club button[type="submit"]');await page.waitForURL(origin+'/panel-club.html');
  await page.click('#canchas-tab');await page.waitForFunction(()=>document.getElementById('canchas-list').textContent.includes('Cancha Web'));
  assert.equal(await page.evaluate(()=>window.clubInjection),undefined);assert.equal(await page.locator('#canchas-list img[src="x"]').count(),0);
  await page.click('#agregar-cancha');await page.waitForSelector('#modalCancha.show');await page.fill('#nombre-cancha','Nueva Cancha Web');await page.fill('#precio-cancha','1500');
  await Promise.all([page.waitForResponse(r=>r.url()===apiBase+'/canchas'&&r.request().method()==='POST'),page.click('#guardar-cancha')]);
  await page.waitForFunction(()=>document.getElementById('canchas-list').textContent.includes('Nueva Cancha Web'));const added=await Cancha.findOne({nombre:'Nueva Cancha Web'});assert.ok(added);
  const card=page.locator('#canchas-list .card').filter({hasText:'Nueva Cancha Web'});await card.getByRole('button',{name:'Editar',exact:true}).click();await page.waitForSelector('#modalCancha.show');await page.waitForFunction(()=>window._canchaAEditar===null&&document.getElementById('nombre-cancha').value==='Nueva Cancha Web');await page.fill('#precio-cancha','1800');
  const [editedResponse]=await Promise.all([page.waitForResponse(r=>r.url()===apiBase+'/canchas/'+added._id&&r.request().method()==='PUT'),page.click('#guardar-cancha')]);assert.equal(editedResponse.status(),200,await editedResponse.text());assert.equal((await Cancha.findById(added._id)).precio,1800);await page.waitForSelector('#modalCancha.show',{state:'hidden'});
  await Promise.all([page.waitForResponse(r=>r.url()===apiBase+'/canchas/'+added._id&&r.request().method()==='DELETE'),card.getByRole('button',{name:'Eliminar',exact:true}).click()]);assert.equal(await Cancha.findById(added._id),null);
  await page.click('#agenda-tab');await page.waitForSelector('.fc-view');
  await page.evaluate(()=>document.getElementById('calendar-unico')._calendar.gotoDate('2030-01-10'));
  const freeSlot=page.locator('.fc-timegrid-col[data-date="2030-01-10"] .fc-event').filter({hasText:'Libre'}).first();await freeSlot.waitFor();await freeSlot.click();await page.waitForSelector('#modalTurno.show');
  await page.fill('#nombreCliente','Cliente Manual');await page.fill('#telefonoCliente','3534000000');await page.fill('#emailCliente','manual@example.com');
  const [bookingResponse]=await Promise.all([page.waitForResponse(r=>r.url()===apiBase+'/reservar-turno'&&r.request().method()==='POST'),page.click('#btn-reservar-turno')]);assert.equal(bookingResponse.status(),200,await bookingResponse.text());
  const Turno=require(back+'/models/Turno');const manual=await Turno.findOne({emailReservado:'manual@example.com'});assert.ok(manual);assert.equal(manual.telefonoReservado,'3534000000');
  await page.waitForSelector('#modalTurno.show',{state:'hidden'});
  await page.click('#reservas-tab');await page.waitForFunction(()=>document.getElementById('reservas-list').textContent.includes('web@example.com'),null,{timeout:5000}).catch(async e=>{console.log('Reservation UI diagnosis',await page.locator('#reservas-list').textContent(),errors);throw e;});
  const manualRow=page.locator('#reservas-list tr').filter({hasText:'manual@example.com'});await manualRow.waitFor();assert.ok((await manualRow.textContent()).includes('Cliente Manual'));assert.ok((await manualRow.textContent()).includes('3534000000'));
  const sdk=require(back+'/utils/mercadopago');const originalPreference=sdk.preferences.create;
  try {
    await Club.updateOne({_id:club._id},{$set:{mercadoPagoAccessToken:'TEST-browser-club'}});
    sdk.preferences.create=async(body,options)=>{assert.equal(options.access_token,'TEST-browser-club');assert.equal(body.external_reference,require(back+'/services/payments').paymentReference(manual));return {body:{init_point:'https://sandbox.example.test/manual-payment'}};};
    const [linkResponse]=await Promise.all([page.waitForResponse(r=>r.url()===apiBase+'/turnos/'+manual._id+'/payment-link'),manualRow.locator('.generar-pago').click()]).catch(e=>{console.log('Payment request diagnosis',dialogs,errors);throw e;});assert.equal(linkResponse.status(),200,await linkResponse.text());await page.waitForSelector('#club-payment-dialog[open]',{timeout:5000}).catch(e=>{console.log('Payment dialog diagnosis',dialogs,errors);throw e;});
    assert.equal(await page.locator('#club-payment-dialog a').first().getAttribute('href'),'https://sandbox.example.test/manual-payment');
    const share=page.locator('#club-payment-dialog a').filter({hasText:'Compartir por WhatsApp'});assert.ok((await share.getAttribute('href')).startsWith('https://wa.me/5493534000000?'));
    await page.locator('#club-payment-dialog').getByRole('button',{name:'Cerrar',exact:true}).click();
    await Turno.updateOne({_id:manual._id},{$set:{telefonoReservado:null}});
    await manualRow.locator('.generar-pago').click();await page.waitForSelector('#club-payment-dialog[open]');
    assert.ok((await page.locator('#club-payment-dialog').textContent()).includes('no hay un teléfono válido'));
    assert.equal(await page.locator('#club-payment-dialog a').count(),1);
    await page.locator('#club-payment-dialog').getByRole('button',{name:'Cerrar',exact:true}).click();
  }finally{sdk.preferences.create=originalPreference;}
  const [cancelResponse]=await Promise.all([page.waitForResponse(r=>r.url()===apiBase+'/turnos/'+manual._id+'/cancelar'),manualRow.locator('.cancelar-reserva').click()]);assert.equal(cancelResponse.status(),200);assert.equal((await Turno.findById(manual._id)).usuarioReservado,null);
  assert.equal((await fetch(apiBase+'/turnos/'+manual._id+'/marcar-pagado',{method:'PATCH',headers:{Authorization:'Bearer '+await page.evaluate(()=>localStorage.getItem('clubToken'))}})).status,409);
  const paid=await Turno.create({canchaId:String(cancha._id),club:club.email,deporte:'padel',fecha:'2030-01-10',hora:'09:00',precio:1000,usuarioReservado:'Pago Manual',emailReservado:'paid@example.com',bookingId:'web-paid'});
  await page.click('#info-tab');await page.click('#reservas-tab');const paidRow=page.locator('#reservas-list tr').filter({hasText:'paid@example.com'});await paidRow.waitFor();
  const [paidResponse]=await Promise.all([page.waitForResponse(r=>r.url()===apiBase+'/turnos/'+paid._id+'/marcar-pagado'),paidRow.locator('.marcar-pagada').click()]);assert.equal(paidResponse.status(),200);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('#reservas-list tr')).some(r=>r.textContent.includes('paid@example.com')&&r.textContent.includes('Pagado')));
  const [paidCancel]=await Promise.all([page.waitForResponse(r=>r.url()===apiBase+'/turnos/'+paid._id+'/cancelar'),paidRow.locator('.cancelar-reserva').click()]);assert.equal(paidCancel.status(),409);
  await page.waitForTimeout(100);assert.ok(dialogs.some(t=>t.includes('reintegro')));assert.equal((await Turno.findById(paid._id)).pagado,true);assert.equal((await Turno.findById(paid._id)).pagoMetodo,'manual');
  await page.click('#compartir-tab');await page.waitForFunction(()=>document.getElementById('club-link-buscador').value.includes('club'));await page.click('#btn-generar-qr-buscador');await page.waitForSelector('#qr-buscador canvas');
  await page.goto(origin+'/estadisticas.html');await page.waitForFunction(()=>document.getElementById('kpi-reservas').textContent!=='—');
  assert.ok(await page.evaluate(()=>Chart.getChart('chart-reservas-dia')));
  await page.selectOption('#select-mes',{index:1});await page.waitForFunction(()=>document.getElementById('kpi-ocupacion').textContent!=='—');
  await page.goto(origin+'/panel-club.html');await page.waitForSelector('#canchas-tab');
  await page.click('#reservas-tab');await page.waitForSelector('#reservas-list tr');
  await page.waitForFunction(()=>document.getElementById('reservasTab').classList.contains('show') && getComputedStyle(document.getElementById('reservasTab')).opacity==='1');
  assert.equal(await page.locator('#clubTabs > li > .active').count(),1);
  await page.screenshot({path:path.join(artifacts,'panel-club-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(artifacts,'panel-club-mobile.png'),fullPage:true});
  await page.click('#cerrar-sesion');await page.waitForURL(origin+'/login-club.html');assert.equal(await page.evaluate(()=>localStorage.getItem('clubToken')),null);assert.deepEqual(errors,[]);
  console.log('E2E real OK: login, cookie HttpOnly, refresh entre páginas, editar perfil, hold, OTP, confirmación y logout; SuperAdmin: login, secciones, edición de club, texto seguro, configuración y logout; Club: login, ABM de canchas, reserva manual desde agenda, teléfono, enlace de pago, preparación de WhatsApp sin enviar, cancelación, QR, estadísticas y logout; recursos JS/CSS locales, MongoDB aislado y correo simulado, sin producción.');
 }finally{if(browser)await browser.close();if(api)await new Promise(r=>api.close(r));if(web)await new Promise(r=>web.close(r));await mongoose.disconnect();await mongo.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
