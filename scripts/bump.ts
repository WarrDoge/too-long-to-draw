const file = Bun.file("package.json");
const text = await file.text();
await Bun.write(
  file,
  text.replace(/"packageManager": "bun@[^"]+"/, `"packageManager": "bun@${Bun.version}"`),
);
console.log(`Pinned bun@${Bun.version}`);
