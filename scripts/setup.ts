const pin = (await Bun.file("package.json").json()).packageManager.split("@")[1];
if (Bun.version !== pin) throw new Error(`Bun ${Bun.version} does not match the pinned ${pin}`);
if (!(await Bun.file("/usr/bin/chromium").exists()))
  throw new Error("/usr/bin/chromium is missing");
console.log(`Bun ${pin} and /usr/bin/chromium OK`);
