// Pixie Scout Cloudflare Worker — no credentials belong in this file.
// Set OPENAI_API_KEY and SCOUT_ACCESS_TOKEN as encrypted Worker secrets.
// Prototype: requires bearer token. Do not embed that token in public website code.
const ORIGIN = "https://davidmwhitmer-dev.github.io";
function headers(origin) { return {"Access-Control-Allow-Origin":origin===ORIGIN?ORIGIN:"null","Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Cache-Control":"no-store"}; }
function reply(obj,status,origin){return new Response(JSON.stringify(obj),{status,headers:{"Content-Type":"application/json",...headers(origin)}});}
export default {
 async fetch(req,env) {
  const origin=req.headers.get("Origin")||"";
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(origin)});
  if(req.method!=="POST"||new URL(req.url).pathname!=="/analyze")return reply({error:"Not found"},404,origin);
  if(origin!==ORIGIN)return reply({error:"Origin not allowed"},403,origin);
  if(!env.OPENAI_API_KEY||!env.SCOUT_ACCESS_TOKEN)return reply({error:"Configure both Worker secrets"},503,origin);
  if(req.headers.get("Authorization")!=="Bearer "+env.SCOUT_ACCESS_TOKEN)return reply({error:"Unauthorized"},401,origin);
  try {
   if(Number(req.headers.get("content-length")||0)>13000000)return reply({error:"Too large"},413,origin);
   const body=await req.json(),images=body.images;
   if(!Array.isArray(images)||images.length<1||images.length>5||images.some(i=>typeof i!=="string"||i.length>2500000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(i)))return reply({error:"Provide 1-5 JPEG, PNG or WebP photos under 2.5 MB each"},400,origin);
   const instruction='Identify ONE Disney resale item from multiple photos. Never invent authenticity, rarity, edition number, condition, or sold prices. Return JSON object with name, category (Loungefly/Disney Keys/Minnie Ears/Plush/Clothing/Other), condition (New with tags/New without tags/Excellent used/Good used/Fair used), character, size, description, listingTitle (80 characters max), keywords, collectibleAlert (boolean), confidence (high/medium/low), needsMorePhotos (array), observedDetails (array), uncertainties (array), pricingNote. Explain uncertainty and request more photos as needed. Do not claim to have researched sold prices.';
   const result=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",input:[{role:"user",content:[{type:"input_text",text:instruction},...images.map(image_url=>({type:"input_image",image_url,detail:"low"}))]}],max_output_tokens:1100,text:{format:{type:"json_object"}}})});
   const out=await result.json();
   if(!result.ok)return reply({error:"OpenAI request failed",detail:out.error?.message||"Unknown error"},502,origin);
   const content=(out.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("");
   if(!content)return reply({error:"No AI result"},502,origin);
   return reply({ok:true,analysis:JSON.parse(content)},200,origin);
  }catch(e){return reply({error:"Analysis failed",detail:String(e.message||e)},500,origin);}
 }
};
