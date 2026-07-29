import "dotenv/config";
import openpyxlDummy from "fs";
import fs from "fs";
const rows = JSON.parse(fs.readFileSync("C:/Users/sbart/AppData/Local/Temp/claude/C--Users-sbart-Documents-Claude/efa8d454-f555-4895-823e-5582b1ea996f/scratchpad/closet-import.json","utf8"));
const url = process.env.SEED_URL || "http://localhost:8123";
const pass = process.env.APP_PASSCODE || "";
const r = await fetch(url+"/api/closet", {
  method:"PUT",
  headers:{"Content-Type":"application/json","X-Passcode":pass},
  body: JSON.stringify(rows)
});
console.log("seed →", r.status, await r.text());
const c = await fetch(url+"/api/closet",{headers:{"X-Passcode":pass}});
const back = await c.json();
console.log("readback items:", back.items?.length, "| units:", back.items?.reduce((a,i)=>a+i.qty,0), "| value: $"+back.items?.reduce((a,i)=>a+i.qty*i.price,0).toFixed(2));
