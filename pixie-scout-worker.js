// Pixie Scout Cloudflare Worker — no credentials belong in this file.
// Set OPENAI_API_KEY, SCOUT_ACCESS_TOKEN and SERPAPI_API_KEY as encrypted Worker secrets.
// Prototype: requires bearer token. Do not embed that token in public website code.
const ORIGIN = "https://davidmwhitmer-dev.github.io";
function headers(origin) { return {"Access-Control-Allow-Origin":origin===ORIGIN?ORIGIN:"null","Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Cache-Control":"no-store"}; }
function reply(obj,status,origin){return new Response(JSON.stringify(obj),{status,headers:{"Content-Type":"application/json",...headers(origin)}});}
export default {
 async fetch(req,env) {
  const origin=req.headers.get("Origin")||"";
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(origin)});
  if(req.method!=="POST"||!["/analyze","/research"].includes(new URL(req.url).pathname))return reply({error:"Not found"},404,origin);
  if(origin!==ORIGIN)return reply({error:"Origin not allowed"},403,origin);
  if(!env.OPENAI_API_KEY||!env.SCOUT_ACCESS_TOKEN)return reply({error:"Configure both Worker secrets"},503,origin);
  if(req.headers.get("Authorization")!=="Bearer "+env.SCOUT_ACCESS_TOKEN)return reply({error:"Unauthorized"},401,origin);
  if(new URL(req.url).pathname==="/research") {
   if(!env.SERPAPI_API_KEY)return reply({error:"SERPAPI_API_KEY is not configured"},503,origin);
   try {
    const body=await req.json(),query=String(body.query||"").trim().slice(0,160);
    if(query.length<4)return reply({error:"Search query is too short"},400,origin);
    const markets=[["eBay","ebay.com"],["Mercari","mercari.com"],["Poshmark","poshmark.com"],["Facebook Marketplace","facebook.com/marketplace"]];
    const results=await Promise.all(markets.map(async ([market,site])=>{
     try {
      const p=new URLSearchParams({engine:"google",q:"site:"+site+" "+query+" price",num:"20",api_key:env.SERPAPI_API_KEY});
      const response=await fetch("https://serpapi.com/search.json?"+p);
      const data=await response.json();
      if(!response.ok||data.error)return {market,status:"unavailable",reason:String(data.error||"Search provider error").slice(0,180),listings:[]};
      const listings=[],seen=new Set();
      for(const item of data.organic_results||[]){
       const link=String(item.link||"");
       if(!link.startsWith("https://")||seen.has(link))continue;
       if(!new URL(link).hostname.endsWith(site.split("/")[0]))continue;
       const rich=item.rich_snippet?.top?.detected_extensions||{};
       const ext=item.rich_snippet?.bottom?.detected_extensions||{};
       const direct=[rich.price,ext.price,item.price,item.extracted_price].map(Number).find(v=>Number.isFinite(v)&&v>0);
       const raw=[item.title||"",item.snippet||"",JSON.stringify(item.rich_snippet||{}),JSON.stringify(item.extensions||[])].join(" ");
       const found=raw.match(/(?:US\\s*)?\\$\\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\\.[0-9]{2})?)/);
       if(!found&&!direct)continue;
       const price=direct||Number(found[1].replace(/,/g,""));
       if(!(price>0&&price<100000))continue;
       seen.add(link);
       listings.push({title:String(item.title||"").slice(0,180),url:link,price});
      }
      return {market,status:listings.length?"found":"no_prices",listings:listings.slice(0,20),searchedAt:new Date().toISOString()};
     }catch(e){return {market,status:"unavailable",reason:"Search failed",listings:[]}}
    }));
    return reply({ok:true,query,markets:results,disclaimer:"Publicly indexed asking-price candidates only; results may be stale or mismatched. No sold-price verification."},200,origin);
   }catch(e){return reply({error:"Research failed",detail:String(e.message||e)},500,origin)}
  }
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
