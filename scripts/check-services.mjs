const services = [
  ['Web', process.env.WEB_URL || 'http://localhost:3000/health'],
  ['Organization Service', process.env.ORG_HEALTH_URL || 'http://localhost:4101/health'],
  ['Identity Service', process.env.IDENTITY_HEALTH_URL || 'http://localhost:4102/health'],
  ['Request Service', process.env.REQUEST_HEALTH_URL || 'http://localhost:4103/health']
];

for (const [name, url] of services) {
  try {
    const response = await fetch(url);
    const body = await response.json();
    console.log(`${name}: ${response.ok ? 'OK' : 'NOT OK'} - ${body.status || response.status}`);
  } catch (error) {
    console.log(`${name}: DOWN - ${error.message}`);
  }
}
