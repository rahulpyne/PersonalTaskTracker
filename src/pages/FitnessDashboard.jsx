/**
 * FitnessDashboard v3 — primary fitness view
 * Sections: 01 This week · 02 Activity focus · 03 Routes map · 04 Heatmap
 *           05 Recovery & goals · 06 Training plan · 07 Insights & feed
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet'
import { supabase } from '../lib/supabase'

// ── Palette ───────────────────────────────────────────────────────────────────
const TC = {
  run:'oklch(72% 0.19 25)', ride:'oklch(72% 0.18 250)', swim:'oklch(75% 0.16 200)',
  walk:'oklch(70% 0.10 110)', hike:'oklch(72% 0.12 130)', strength:'oklch(72% 0.18 300)',
  yoga:'oklch(75% 0.14 160)', hiit:'oklch(78% 0.20 50)', workout:'oklch(70% 0.08 260)',
  cardio:'oklch(70% 0.08 260)',
}
const ORANGE = 'oklch(75% 0.18 50)'

// ── Strength standards (ExRx normative data · ratios × bodyweight) ────────────
// [untrained, beginner, novice, intermediate, advanced, elite]
const LIFT_RATIOS = {
  bench:    [0.50, 0.75, 1.00, 1.35, 1.75, 2.10],
  squat:    [0.65, 0.90, 1.25, 1.65, 2.10, 2.60],
  deadlift: [0.75, 1.10, 1.50, 1.95, 2.45, 3.05],
  ohp:      [0.35, 0.50, 0.65, 0.85, 1.10, 1.35],
  row:      [0.40, 0.60, 0.80, 1.05, 1.35, 1.65],
}
const LEVEL_LABELS  = ['Untrained','Beginner','Novice','Intermediate','Advanced','Elite']
const LEVEL_PCTS    = [5, 25, 45, 65, 82, 93]  // approximate gym-goer percentiles
const LEVEL_COLORS  = [
  'rgba(255,255,255,0.25)','oklch(58% 0.15 250)','oklch(65% 0.14 200)',
  'oklch(65% 0.17 145)','oklch(72% 0.18 25)',ORANGE,
]

// Map exercise name substrings → canonical lift key
const CANONICAL_LIFT_MAP = [
  { key:'bench',    terms:['bench press','chest press','barbell bench','flat bench','incline bench press'] },
  { key:'squat',    terms:['barbell squat','back squat','front squat',' squat'] },
  { key:'deadlift', terms:['deadlift','sumo dead','romanian dead','rdl'] },
  { key:'ohp',      terms:['overhead press','military press','shoulder press','smith machine overhead','ohp','arnold press','dumbbell overhead','seated overhead'] },
  { key:'row',      terms:['barbell row','bent over row','chest supported','cable row','seated row','machine row'] },
]

// Muscle-group → colour for body heat map
const MUSCLE_COLORS = {
  chest:'oklch(65% 0.16 25)',   triceps:'oklch(62% 0.15 30)',  front_delts:'oklch(65% 0.16 50)',
  upper_chest:'oklch(60% 0.14 25)', shoulders:'oklch(65% 0.14 50)', delts:'oklch(65% 0.14 50)',
  rear_delts:'oklch(62% 0.13 50)',  lats:'oklch(65% 0.15 250)',     back:'oklch(62% 0.14 250)',
  rhomboids:'oklch(60% 0.13 250)',  traps:'oklch(58% 0.12 250)',    biceps:'oklch(65% 0.14 200)',
  forearms:'oklch(62% 0.12 200)',   core:'oklch(65% 0.15 140)',     abs:'oklch(65% 0.15 140)',
  quadriceps:'oklch(65% 0.16 280)',quads:'oklch(65% 0.16 280)',     hamstrings:'oklch(62% 0.14 300)',
  glutes:'oklch(62% 0.14 320)',     calves:'oklch(60% 0.12 300)',   hip_flexors:'oklch(60% 0.13 310)',
}
const TAB_OPTS = [
  {k:'all',l:'All'},{k:'run',l:'Run'},{k:'ride',l:'Ride'},{k:'swim',l:'Swim'},
  {k:'strength',l:'Strength'},{k:'yoga',l:'Yoga'},{k:'hiit',l:'HIIT'},{k:'walk',l:'Walk'},
]
const DAYS_KEY  = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
const DAYS_ABBR = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const FIGURE_LABEL = {
  run:'Running',ride:'Cycling',swim:'Swimming',strength:'Strength',
  yoga:'Yoga',hiit:'HIIT',walk:'Walking',hike:'Hiking',workout:'Workout',cardio:'Cardio',all:'All activity',
}

// ── Mock fallbacks ────────────────────────────────────────────────────────────
const MOCK_GOALS = [
  {id:1,title:'Run 100 km this month',      target_value:100,  current_value:68,    unit:'km', target_date:'2026-05-31',status:'active',type:'run'},
  {id:5,title:'Lift 110,000 lbs this month', target_value:110000,current_value:62570, unit:'lbs',target_date:'2026-05-31',status:'active',type:'strength'},
]

// ── GymVerse mock data (matches scraped per-set schema) ───────────────────────
const mk=(name,primary,secondary,setsArr,notes=null)=>{
  const working=setsArr.filter(s=>!s.w)
  const topS=working.sort((a,b)=>(b.lbs??0)-(a.lbs??0))[0]||setsArr[0]
  const vol=setsArr.reduce((s,x)=>s+(x.lbs&&x.r?x.lbs*x.r:0),0)
  const e1=topS?.lbs&&topS?.r?Math.round(topS.lbs*(1+topS.r/30)):null
  return{
    name,
    muscle_groups:{primary,secondary},
    sets:setsArr.map((s,i)=>({set_num:i+1,weight_lbs:s.lbs??null,weight_kg:s.lbs?+( s.lbs/2.205).toFixed(1):null,reps:s.r??null,is_warmup:!!s.w,is_dropset:!!s.d,superset_group:s.sg??null})),
    total_sets:working.length||setsArr.length,
    top_set_weight_lbs:topS?.lbs??null,
    top_set_reps:topS?.r??null,
    volume_lbs:vol||null,
    volume_kg:vol?+(vol/2.205).toFixed(1):null,
    e1rm_lbs:e1,
    notes,
  }
}
const MOCK_GYMVERSE=[
  {id:'mock:1',workout_name:'Shoulder / Legs 1',workout_date:'2026-05-20',started_at:'2026-05-20T13:00:00Z',
   duration_secs:3780,total_volume_lbs:28355,total_volume_kg:12859,
   muscle_groups:['calves','delts','glutes','hamstrings','quadriceps','shoulders','triceps'],
   exercises:[
     mk('Smith Machine Overhead Press',['shoulders','triceps'],['upper_chest'],[{lbs:135,r:8,w:1},{lbs:180,r:5},{lbs:180,r:5},{lbs:180,r:5}]),
     mk('Leg Press',['quadriceps','glutes'],['hamstrings','calves'],[{lbs:315,r:10,w:1},{lbs:450,r:8},{lbs:450,r:8},{lbs:450,r:8}]),
     mk('Standing Calf Raise, Weighted',['calves'],[],[{lbs:240,r:12},{lbs:240,r:12},{lbs:240,r:10}]),
     mk('Selector OHP Machine',['shoulders','triceps'],[],[{lbs:150,r:10},{lbs:150,r:10},{lbs:150,r:8}]),
     mk('Seated DB Lateral Raise',['delts','shoulders'],[],[{lbs:25,r:12},{lbs:25,r:12},{lbs:25,r:10}]),
   ]},
  {id:'mock:2',workout_name:'Back / Bicep 1',workout_date:'2026-05-18',started_at:'2026-05-18T13:00:00Z',
   duration_secs:3240,total_volume_lbs:12050,total_volume_kg:5465,
   muscle_groups:['back','biceps','forearms','lats','rhomboids','triceps'],
   exercises:[
     mk('Neutral Grip Lat Pulldown',['lats','rhomboids'],['biceps'],[{lbs:140,r:10,w:1},{lbs:200,r:8},{lbs:200,r:8},{lbs:200,r:8}]),
     mk('Chest Supported DB Row',['back','rhomboids'],['biceps','rear_delts'],[{lbs:55,r:10},{lbs:55,r:10},{lbs:55,r:10}]),
     mk('Seated Cable Row',['back','lats'],['biceps'],[{lbs:140,r:12},{lbs:140,r:12},{lbs:140,r:10}]),
     mk('Dips, Weighted',['triceps','chest'],['front_delts'],[{lbs:25,r:10},{lbs:25,r:10},{lbs:25,r:8}]),
     mk('Seated DB Curl',['biceps'],['forearms'],[{lbs:30,r:12},{lbs:30,r:12},{lbs:30,r:10}]),
   ]},
  {id:'mock:3',workout_name:'Chest / Tricep 2',workout_date:'2026-05-16',started_at:'2026-05-16T13:00:00Z',
   duration_secs:3000,total_volume_lbs:8040,total_volume_kg:3646,
   muscle_groups:['chest','front_delts','triceps'],
   exercises:[
     mk('Barbell Bench Press',['chest','triceps'],['front_delts'],[{lbs:135,r:8,w:1},{lbs:185,r:5,w:1},{lbs:215,r:3},{lbs:215,r:3},{lbs:215,r:3}]),
     mk('High Cable Fly',['chest'],['front_delts'],[{lbs:65,r:10},{lbs:65,r:10},{lbs:65,r:10}]),
     mk('Low Cable Fly',['chest'],['front_delts'],[{lbs:45,r:10},{lbs:45,r:10},{lbs:45,r:10}]),
     mk('Standing Cable Tricep Pushdown',['triceps'],[],[{lbs:60,r:12},{lbs:60,r:12},{lbs:60,r:10}]),
   ]},
  {id:'mock:4',workout_name:'Leg / Shoulder',workout_date:'2026-05-14',started_at:'2026-05-14T17:30:00Z',
   duration_secs:3900,total_volume_lbs:31565,total_volume_kg:14315,
   muscle_groups:['calves','delts','glutes','hamstrings','quadriceps','shoulders'],
   exercises:[
     mk('Barbell Sumo Deadlift',['hamstrings','glutes'],['back','quadriceps'],[{lbs:185,r:5,w:1},{lbs:245,r:4,w:1},{lbs:285,r:3},{lbs:285,r:3},{lbs:285,r:3}]),
     mk('Leg Press',['quadriceps','glutes'],['hamstrings','calves'],[{lbs:315,r:10,w:1},{lbs:450,r:8},{lbs:450,r:8},{lbs:450,r:8}]),
     mk('Barbell Hip Thrust',['glutes'],['hamstrings'],[{lbs:230,r:10},{lbs:230,r:10},{lbs:230,r:10}]),
     mk('Seated DB Overhead Press',['shoulders','triceps'],[],[{lbs:55,r:8},{lbs:55,r:8},{lbs:55,r:8}]),
   ]},
]
const MOCK_PLAN = {
  week_start:'2026-05-19',
  plan:{
    monday:   {type:'run',     durationMins:45,notes:'Easy zone-2 along the canal'},
    tuesday:  {type:'strength',durationMins:50,notes:'Push — bench, OHP, dips'},
    wednesday:{type:'swim',    durationMins:40,notes:'6 × 200m threshold, 30s rest'},
    thursday: {type:'yoga',    durationMins:30,notes:'Mobility + hip openers'},
    friday:   {type:'run',     durationMins:35,notes:'Tempo — 4 × 1km @ T pace'},
    saturday: {type:'ride',    durationMins:90,notes:'Long aerobic ride, find a climb'},
    sunday:   {type:'walk',    durationMins:50,notes:'Active recovery, coffee shop loop'},
  },
}
const MOCK_INSIGHT = {
  week_start:'2026-05-19',
  summary:'Strong base week — running volume up, HRV trending back toward your spring average.',
  insights:{list:[
    'You ran 32% more kilometres than the 4-week average without a spike in resting HR — aerobic base is holding.',
    'Sleep dipped Wednesday (6.1h) and HRV fell 14 points next morning. Lights-out by 11pm on hard-workout eves.',
    'Three strength sessions — first time since February. Keep one upper, one lower to protect run recovery.',
    'VO₂ max nudged up 0.3 over 30 days. The tempo work is paying off; stay the course another 2 weeks.',
  ]},
  highlights:{totalKm:41.6,activeDays:6,avgSteps:11240,avgSleep:7.3,avgHRV:58,avgRestHR:54},
}

// ── Data hook ─────────────────────────────────────────────────────────────────
function useDashboardData() {
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [actR, metR, goalsR, planR, insR, routeR, gymR, prR] = await Promise.all([
          supabase.from('fitness_activities')
            .select('id,source,type,name,started_at,distance_m,duration_secs,moving_secs,avg_hr,max_hr,calories,elevation_gain_m,avg_speed_kmh')
            .order('started_at',{ascending:false}).limit(200),
          supabase.from('fitness_daily_metrics')
            .select('date,steps,active_cals,total_cals,exercise_mins,stand_hours,resting_hr,avg_hr,hrv,vo2_max,sleep_hrs,sleep_deep_hrs,sleep_rem_hrs,weight_kg')
            .order('date',{ascending:false}).limit(90),
          supabase.from('fitness_goals').select('*').eq('status','active'),
          supabase.from('fitness_plans').select('*').order('week_start',{ascending:false}).limit(1).maybeSingle(),
          supabase.from('fitness_insights').select('*').order('week_start',{ascending:false}).limit(1).maybeSingle(),
          // Fetch route data separately — extract polyline from raw JSONB without loading full raw
          supabase.from('fitness_activities')
            .select('id,type,name,started_at,distance_m,duration_secs,avg_hr,elevation_gain_m,raw->map->>summary_polyline,raw->start_latlng,raw->end_latlng')
            .not('raw->map->>summary_polyline','is',null)
            .neq('raw->map->>summary_polyline','')
            .order('started_at',{ascending:false}).limit(100),
          supabase.from('gymverse_workouts')
            .select('id,external_id,workout_name,workout_date,started_at,duration_secs,total_volume_lbs,total_volume_kg,muscle_groups,exercises')
            .order('started_at',{ascending:false}).limit(30),
          supabase.from('gymverse_exercise_prs')
            .select('exercise_name,canonical_key,best_e1rm_lbs,best_weight_lbs,best_reps,best_volume_lbs,achieved_at,history'),
        ])
        const acts    = actR.data    ?? []
        const metrics = (metR.data   ?? []).slice().reverse()
        const plan    = planR.data   ?? MOCK_PLAN
        const insight = insR.data    ?? MOCK_INSIGHT
        const routes  = (routeR.data ?? []).map(r => ({
          ...r,
          polyline: r.summary_polyline,
          startLL:  Array.isArray(r.start_latlng) ? r.start_latlng : null,
          endLL:    Array.isArray(r.end_latlng)   ? r.end_latlng   : null,
        }))
        const gymverse  = gymR.data?.length ? gymR.data : MOCK_GYMVERSE
        const exercisePRs = (prR.data ?? []).reduce((m, row) => { m[row.exercise_name] = row; return m }, {})
        const gymByExtId  = (gymR.data ?? []).reduce((m, w) => { if (w.external_id) m[w.external_id] = w; return m }, {})
        const latestWeightKg = metrics.slice().reverse().find(m => m.weight_kg > 0)?.weight_kg ?? null
        const bodyweightLbs  = latestWeightKg ? Math.round(latestWeightKg * 2.205) : null

        // ── Compute live goal progress from real data ─────────────────────────
        const now        = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10)
        const monthEnd   = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().slice(0,10)
        const monthName  = now.toLocaleDateString('en',{month:'long'})
        const weekAgoISO = new Date(now - 7*86400000).toISOString().slice(0,10)

        const monthRunKm = +(acts
          .filter(a => ['run','Run'].includes(a.type) && a.started_at >= monthStart)
          .reduce((s,a) => s + (a.distance_m||0), 0) / 1000).toFixed(1)

        const monthVolLbs = Math.round((gymR.data??[])
          .filter(w => (w.workout_date||w.started_at?.slice(0,10)) >= monthStart)
          .reduce((s,w) => s + (w.total_volume_lbs||0), 0))

        const weekSessions = (gymR.data??[])
          .filter(w => (w.workout_date||w.started_at?.slice(0,10)) >= weekAgoISO).length

        const weekRunKm = +(acts
          .filter(a => ['run','Run'].includes(a.type) && a.started_at >= weekAgoISO)
          .reduce((s,a) => s + (a.distance_m||0), 0) / 1000).toFixed(1)

        // Build goal rows with computed current values
        // slug is the stable text key used for upsert (id column is UUID, not text)
        const autoGoals = [
          { slug:'auto:run_month',      title:`Run distance — ${monthName}`,      type:'run',      unit:'km',       target_value:100,    current_value:monthRunKm,   target_date:monthEnd, status:'active' },
          { slug:'auto:strength_month', title:`Lift volume — ${monthName}`,        type:'strength', unit:'lbs',      target_value:110000, current_value:monthVolLbs,  target_date:monthEnd, status:'active' },
          { slug:'auto:strength_week',  title:'Strength sessions — this week',     type:'strength', unit:'sessions', target_value:4,      current_value:weekSessions, target_date:null,     status:'active' },
          { slug:'auto:run_week',       title:'Run distance — this week',          type:'run',      unit:'km',       target_value:25,     current_value:weekRunKm,    target_date:null,     status:'active' },
        ]

        // Merge with any custom DB goals (DB takes priority for title/target, we keep live current_value)
        const dbGoals = (goalsR.data ?? [])
        const mergedGoals = autoGoals.map(ag => {
          const db = dbGoals.find(g => g.slug === ag.slug || g.id === ag.slug)
          return db ? { ...ag, ...db, current_value: ag.current_value } : ag
        })
        // Append any DB goals not in autoGoals
        dbGoals.forEach(g => { if (!mergedGoals.find(m => m.slug === g.slug)) mergedGoals.push({...g, current_value:g.current_value??0}) })

        const goals = mergedGoals.map(g => ({...g, current: g.current_value ?? 0}))

        // Upsert computed goals back to DB so insight-generator sees real numbers
        // Use slug as the conflict target (unique text column) — id is auto-generated UUID
        const upsertRows = autoGoals.map(g => ({
          slug:          g.slug,
          title:         g.title,
          type:          g.type,
          unit:          g.unit,
          target_value:  g.target_value,
          current_value: g.current_value,
          target_date:   g.target_date,
          status:        'active',
        }))
        supabase.from('fitness_goals').upsert(upsertRows, {onConflict:'slug'}).then(({error}) => {
          if (error) console.warn('goals upsert:', error.message)
        })

        setD({acts,metrics,goals,plan,insight,routes,gymverse,exercisePRs,bodyweightLbs,gymByExtId})
      } catch(e) {
        console.error('FitnessDashboard load error:',e)
        setD({acts:[],metrics:[],goals:MOCK_GOALS,plan:MOCK_PLAN,insight:MOCK_INSIGHT,routes:[],gymverse:MOCK_GYMVERSE,exercisePRs:{},bodyweightLbs:null,gymByExtId:{}})
      } finally { setLoading(false) }
    }
    load()
  },[])

  return {data:d, loading}
}

// ── Geo utilities ─────────────────────────────────────────────────────────────
function decodePolyline(enc) {
  const coords=[]; let idx=0,lat=0,lng=0
  while(idx<enc.length){
    let b,shift=0,res=0
    do{b=enc.charCodeAt(idx++)-63;res|=(b&0x1f)<<shift;shift+=5}while(b>=0x20)
    lat+=(res&1)?~(res>>1):(res>>1); shift=0;res=0
    do{b=enc.charCodeAt(idx++)-63;res|=(b&0x1f)<<shift;shift+=5}while(b>=0x20)
    lng+=(res&1)?~(res>>1):(res>>1)
    coords.push([lat/1e5,lng/1e5])
  }
  return coords
}

function simplifyPath(coords,tol=0.0003){
  if(coords.length<=2) return coords
  const sqd=(p,a,b)=>{let dx=b[0]-a[0],dy=b[1]-a[1];if(dx||dy){const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2}return (p[0]-a[0])**2+(p[1]-a[1])**2}
  const t2=tol*tol,keep=new Uint8Array(coords.length);keep[0]=keep[coords.length-1]=1
  const stk=[[0,coords.length-1]]
  while(stk.length){const[s,e]=stk.pop();let mx=0,mi=s;for(let i=s+1;i<e;i++){const d=sqd(coords[i],coords[s],coords[e]);if(d>mx){mx=d;mi=i}}if(mx>t2){keep[mi]=1;stk.push([s,mi],[mi,e])}}
  return coords.filter((_,i)=>keep[i])
}

function haversineKm(a,b){
  const R=6371,dLat=(b[0]-a[0])*Math.PI/180,dLon=(b[1]-a[1])*Math.PI/180
  const h=Math.sin(dLat/2)**2+Math.cos(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*Math.sin(dLon/2)**2
  return 2*R*Math.asin(Math.sqrt(h))
}

// ── GIS insights ──────────────────────────────────────────────────────────────
function computeGIS(routes) {
  if(!routes.length) return null
  const withCoords = routes.map(r=>({...r,coords:r.polyline?simplifyPath(decodePolyline(r.polyline)):null})).filter(r=>r.coords?.length)
  if(!withCoords.length) return null

  // Center of mass from start points
  const starts = withCoords.filter(r=>r.startLL).map(r=>r.startLL)
  const center = starts.length
    ? [starts.reduce((s,p)=>s+p[0],0)/starts.length, starts.reduce((s,p)=>s+p[1],0)/starts.length]
    : withCoords[0].coords[0]

  // Unique ~500m grid cells explored
  const cells = new Set()
  withCoords.forEach(r=>r.coords.forEach(([la,lo])=>cells.add(`${(la*200|0)}_${(lo*200|0)}`)))

  // Farthest start point from center
  let maxKm=0, farthest=null
  withCoords.forEach(r=>{
    if(!r.startLL) return
    const d=haversineKm(center,r.startLL)
    if(d>maxKm){maxKm=d;farthest=r}
  })

  // Route clustering: group by similar start point (0.003° ≈ 300m grid)
  const clusters={}
  withCoords.forEach(r=>{
    if(!r.startLL) return
    const key=`${(r.startLL[0]*333|0)}_${(r.startLL[1]*333|0)}`
    if(!clusters[key]) clusters[key]=[]
    clusters[key].push(r)
  })
  const topCluster=Object.values(clusters).sort((a,b)=>b.length-a.length)[0]||[]
  const uniqueRoutes=Object.keys(clusters).length

  // Longest activity
  const longest=withCoords.reduce((b,r)=>(!b||r.distance_m>b.distance_m)?r:b,null)

  // Total mapped km
  const totalKm=+(withCoords.reduce((s,r)=>s+(r.distance_m||0),0)/1000).toFixed(1)

  // By-type breakdown
  const byType={}
  withCoords.forEach(r=>{byType[r.type]=(byType[r.type]||0)+1})

  return {withCoords,center,cells:cells.size,maxKm:+maxKm.toFixed(1),farthest,topCluster,uniqueRoutes,longest,totalKm,byType}
}

// ── Weekly stats with real deltas ─────────────────────────────────────────────
function thisWeekStats(acts,metrics){
  const today=new Date();today.setHours(0,0,0,0)
  const dow=today.getDay()===0?7:today.getDay()
  const monThis=new Date(today);monThis.setDate(monThis.getDate()-(dow-1))
  const monPrev=new Date(monThis);monPrev.setDate(monPrev.getDate()-7)

  const wkActs=acts.filter(a=>new Date(a.started_at)>=monThis)
  const prActs=acts.filter(a=>{const t=new Date(a.started_at);return t>=monPrev&&t<monThis})

  const sumDist=arr=>+(arr.reduce((s,a)=>s+(a.distance_m||0),0)/1000).toFixed(1)
  const countDays=arr=>new Set(arr.map(a=>a.started_at.slice(0,10))).size

  const avgMet=(arr,k,dec=1)=>{
    const v=arr.filter(d=>d[k]!=null)
    return v.length ? +( v.reduce((s,d)=>s+d[k],0)/v.length).toFixed(dec) : null
  }

  const last7=metrics.slice(-7), prev7=metrics.slice(-14,-7)
  const distKm=sumDist(wkActs),   prevDistKm=sumDist(prActs)
  const days=countDays(wkActs),   prevDays=countDays(prActs)
  const avgHRV=avgMet(last7,'hrv'),     prevHRV=avgMet(prev7,'hrv')
  const restHR=avgMet(last7,'resting_hr',0), prevRestHR=avgMet(prev7,'resting_hr',0)
  const avgSleep=avgMet(last7,'sleep_hrs'), prevSleep=avgMet(prev7,'sleep_hrs')

  const delta=(cur,prev,dec=1)=>{
    if(cur==null||prev==null) return null
    const d=+(cur-prev).toFixed(dec)
    return {text:(d>=0?'+':'')+d,up:d>=0}
  }

  const freq=wkActs.length
    ? Object.entries(wkActs.reduce((c,a)=>{c[a.type]=(c[a.type]||0)+1;return c},{})).sort((a,b)=>b[1]-a[1])[0][0]
    : 'run'

  // Recovery status from latest HRV
  const latestHRV=last7.filter(d=>d.hrv!=null).slice(-1)[0]?.hrv
  const recoveryStatus=!latestHRV?'unknown':latestHRV<40?'fatigued':latestHRV<55?'moderate':'recovered'

  return {
    distKm,prevDistKm,days,prevDays,avgHRV,prevHRV,restHR,prevRestHR,avgSleep,prevSleep,
    weekActivities:wkActs,mostFreqType:freq,recoveryStatus,
    deltas:{
      dist: delta(distKm,prevDistKm),
      days: delta(days,prevDays,0),
      hrv:  delta(avgHRV,prevHRV),
      hr:   delta(restHR,prevRestHR,0),
      sleep:delta(avgSleep,prevSleep),
    },
  }
}

function weeklyTotals(acts,n=8){
  const today=new Date();today.setHours(0,0,0,0)
  const dow=today.getDay()===0?7:today.getDay()
  const mon=new Date(today);mon.setDate(mon.getDate()-(dow-1))
  return Array.from({length:n},(_,w)=>{
    const start=new Date(mon);start.setDate(start.getDate()-(n-1-w)*7)
    const end=new Date(start);end.setDate(end.getDate()+7)
    const wActs=acts.filter(a=>{const t=new Date(a.started_at).getTime();return t>=start.getTime()&&t<end.getTime()})
    return {start,label:start.toLocaleString('en',{month:'short',day:'numeric'}),total_km:+(wActs.reduce((s,a)=>s+(a.distance_m||0),0)/1000).toFixed(1),isCurrent:w===n-1}
  })
}

// MET values per activity type (used for calorie estimation)
const MET_TABLE={run:9.8,ride:7.5,swim:8.0,walk:3.5,hike:5.3,strength:5.0,hiit:8.5,yoga:2.5,cardio:6.0,workout:5.5}
function estimateCals(act){
  if(!act.duration_secs) return 0
  const met=MET_TABLE[act.type]||5
  const hrs=act.duration_secs/3600
  return Math.round(met*70*hrs) // 70 kg reference weight
}

function heatmapData(acts){
  const DAYS=26*7,byDay={}
  acts.forEach(a=>{
    const k=a.started_at.slice(0,10)
    if(!byDay[k])byDay[k]={cals:0,mins:0,acts:[]}
    byDay[k].cals+=(a.calories||estimateCals(a))
    byDay[k].mins+=(a.duration_secs||0)/60
    byDay[k].acts.push(a)
  })
  const today=new Date();today.setHours(0,0,0,0)
  return Array.from({length:DAYS},(_,i)=>{
    const d=new Date(today);d.setDate(d.getDate()-(DAYS-1-i));d.setHours(0,0,0,0)
    const k=d.toISOString().slice(0,10)
    return{date:k,dateObj:d,...(byDay[k]||{cals:0,mins:0,acts:[]})}
  })
}

function computeStreak(acts){
  if(!acts.length) return {days:0,weeks:0}
  const activeDays=new Set(acts.map(a=>a.started_at.slice(0,10)))
  const today=new Date();today.setHours(0,0,0,0)

  // ── Daily streak ──────────────────────────────────────────────────────────
  const todayKey=today.toISOString().slice(0,10)
  let dd=new Date(today),dayStreak=0
  if(!activeDays.has(todayKey)) dd.setDate(dd.getDate()-1)
  while(activeDays.has(dd.toISOString().slice(0,10))){dayStreak++;dd.setDate(dd.getDate()-1)}

  // ── Weekly streak (matches Strava: consecutive Mon→Sun weeks with ≥1 act) ─
  const weekMonday=d=>{const x=new Date(d);x.setHours(0,0,0,0);const dow=x.getDay()===0?6:x.getDay()-1;x.setDate(x.getDate()-dow);return x}
  const weekHasActivity=mon=>{for(let i=0;i<7;i++){const x=new Date(mon);x.setDate(x.getDate()+i);if(activeDays.has(x.toISOString().slice(0,10)))return true}return false}
  // Strava counts completed weeks + current week only if Sunday has passed.
  // Practically: always start from the most-recent fully-elapsed week,
  // then extend forward by 1 if the current week already has an activity.
  const curWeekMon=weekMonday(today)
  const currentWeekActive=weekHasActivity(curWeekMon)
  // Strava streak = fully-CLOSED consecutive weeks. Current (partial) week
  // is NOT counted until Sunday midnight — shown separately as a badge detail.
  let wk=new Date(curWeekMon);wk.setDate(wk.getDate()-7) // start at last completed week
  let weekStreak=0
  while(weekHasActivity(wk)){weekStreak++;wk.setDate(wk.getDate()-7)}

  return {days:dayStreak,weeks:weekStreak,currentWeekActive}
}

// ── Coaching insight text ─────────────────────────────────────────────────────
function getStatTip(type,value,delta){
  switch(type){
    case 'distance':{
      const d=delta?parseFloat(delta.text):null
      if(d!=null&&d>10) return {head:'⚠ Big jump',body:`+${d.toFixed(1)} km from last week exceeds the 10% safety rule. Add extra sleep and keep tomorrow easy — overuse injuries peak at 2–4 weeks after a spike.`}
      if(d!=null&&d>0)  return {head:'Growing nicely',body:`Up ${d.toFixed(1)} km from last week. Steady 5–10% weekly increases build fitness without injury risk.`}
      if(d!=null&&d<-5) return {head:'Light week',body:`Down ${Math.abs(d).toFixed(1)} km. Deload weeks are intentional — aerobic base holds for 10–14 days without volume.`}
      return {head:'Weekly distance',body:'Consistency compounds. Even a 20-min easy run on busy days protects your base fitness.'}
    }
    case 'active_days':{
      if(value>=6) return {head:'High frequency',body:'Training 6+ days — ensure ≥2 are truly easy (zone 2). More sessions only improve fitness if you can absorb the load.'}
      if(value<=2) return {head:'Low frequency',body:'Research shows 3–4 sessions/week is the threshold for sustained adaptation. One extra 30-min session this week?'}
      return {head:'Active days',body:'Training frequency is the most durable fitness predictor. You\'re building the habit that matters most.'}
    }
    case 'hrv':{
      if(!value) return {head:'Enable HRV',body:'HRV tracking lives in Apple Health → Health Data → Heart. Daily readiness scores replace guesswork with data.'}
      if(value<40) return {head:'Rest today',body:`Sub-40ms HRV signals deep fatigue. Replace hard sessions with a 30-min walk — pushing through low-HRV days adds 2–3 recovery days later.`}
      if(value<55) return {head:'Moderate fatigue',body:`${value}ms below your likely baseline. Avoid HIIT — tempo or easy aerobic is safer. Dehydration alone can lower HRV 5–10ms.`}
      if(delta&&!delta.up&&parseFloat(delta.text)<-6) return {head:'Declining trend',body:'Week-on-week HRV decline often precedes overtraining or illness. Cut intensity 20% until it stabilises.'}
      return {head:'Well recovered',body:`${value}ms HRV — nervous system ready. Good day for a quality session: tempo run, hard strength, or intervals.`}
    }
    case 'resting_hr':{
      if(value>65) return {head:'Elevated',body:`${value}bpm above 65 often indicates fatigue, poor sleep, or early illness. Dehydration can add 5–8bpm. Drink water before re-assessing.`}
      if(value>55) return {head:'Normal range',body:'Consistent aerobic training drops resting HR by ~1bpm/month. Track this as a long-term fitness marker.'}
      return {head:'Strong aerobic base',body:`${value}bpm — excellent cardiac efficiency. Each bpm below 60 at rest reflects years of quality endurance work.`}
    }
    case 'sleep':{
      if(!value) return {head:'No sleep data',body:'Sleep quality has more impact on performance than training volume. Connect Apple Health to unlock recovery insights.'}
      if(value<6)  return {head:'⚠ Sleep debt',body:'Under 6h impairs muscle protein synthesis, HRV, and reaction time. Cancel tonight\'s late plans — sleep debt accumulates.'}
      if(value<7)  return {head:'Below optimal',body:'Even 30 extra minutes/night measurably improves recovery markers. Try lights-out 30min earlier this week.'}
      if(value>9)  return {head:'High sleep need',body:`${value}h suggests heavy training load or illness. Check whether performance matches the extra rest.`}
      return {head:'Excellent sleep',body:`${value}h — right in the athlete's sweet spot. Consistent bedtime timing matters as much as duration.`}
    }
    default: return null
  }
}

// ── CountUp ───────────────────────────────────────────────────────────────────
function CountUp({to,dec=0,dur=1.6}){
  const [v,setV]=useState(0)
  useEffect(()=>{
    let raf;const t0=performance.now()
    const tick=t=>{const k=Math.min(1,(t-t0)/(dur*1000)),e=1-Math.pow(1-k,3);setV(to*e);if(k<1)raf=requestAnimationFrame(tick)}
    raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf)
  },[to,dur])
  return <>{dec>0?v.toFixed(dec):Math.round(v).toLocaleString()}</>
}

// ── ProgressRing ──────────────────────────────────────────────────────────────
function ProgressRing({value,max,status='on-track'}){
  const pct=Math.min(1,(value||0)/(max||1))
  const sz=90,sw=8,r=sz/2-sw/2-2,C=2*Math.PI*r
  const col=status==='overdue'?'var(--bad)':status==='behind'?'var(--warn)':'var(--good)'
  const [shown,setShown]=useState(0)
  useEffect(()=>{
    let raf;const t0=performance.now()
    const tick=t=>{const k=Math.min(1,(t-t0)/1400),e=1-Math.pow(1-k,3);setShown(pct*e);if(k<1)raf=requestAnimationFrame(tick)}
    raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf)
  },[pct])
  return(
    <div style={{position:'relative',width:sz,height:sz,flexShrink:0}}>
      <svg width={sz} height={sz} viewBox={`0 0 ${sz} ${sz}`}>
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw}/>
        <motion.circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke={col} strokeWidth={sw}
          strokeLinecap="round" strokeDasharray={C}
          initial={{strokeDashoffset:C}} animate={{strokeDashoffset:C*(1-pct)}}
          transition={{duration:1.4,ease:[0.2,0.7,0.2,1]}}
          transform={`rotate(-90 ${sz/2} ${sz/2})`}/>
      </svg>
      <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'var(--fd-serif)',fontSize:22,color:'var(--fd-ink1)'}}>
        {Math.round(shown*100)}<span style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',marginLeft:1}}>%</span>
      </div>
    </div>
  )
}

// ── Ticker ────────────────────────────────────────────────────────────────────
function Ticker({acts,metrics}){
  const recent=metrics.slice(-1)[0]
  const totalKm=+(acts.reduce((s,a)=>s+(a.distance_m||0),0)/1000).toFixed(0)
  const items=[
    `${acts.length} ACTIVITIES`,`${totalKm} KM TOTAL`,
    recent?`HRV ${recent.hrv??'—'} MS`:'APPLE HEALTH CONNECTED',
    recent?`RESTING HR ${recent.resting_hr??'—'} BPM`:'SYNC ACTIVE',
    'STRAVA · APPLE HEALTH',
    new Date().toLocaleDateString('en',{weekday:'long',month:'short',day:'numeric'}).toUpperCase(),
    'KEEP MOVING',
  ]
  const rep=[...items,...items]
  return(
    <div style={{overflow:'hidden',borderBottom:'1px solid rgba(255,255,255,0.06)',background:'rgba(255,255,255,0.02)'}}>
      <div style={{display:'flex',animation:'fd-ticker 22s linear infinite',whiteSpace:'nowrap',width:'max-content'}}>
        {rep.map((item,i)=>(
          <span key={i} style={{fontFamily:'var(--fd-mono)',fontSize:10,letterSpacing:'.18em',color:'var(--fd-ink3)',padding:'9px 32px',borderRight:'1px solid rgba(255,255,255,0.04)'}}>
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHead({num,title,label,right}){
  return(
    <motion.div initial={{opacity:0,y:30}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:0.3}} transition={{duration:0.55,ease:[0.2,0.7,0.2,1]}}
      style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:18,marginBottom:20,paddingBottom:16,borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
      <div style={{display:'flex',alignItems:'flex-end',gap:20}}>
        <span style={{fontFamily:'var(--fd-mono)',fontSize:11,color:'var(--fd-ink3)',letterSpacing:'.16em',paddingBottom:3}}>{num}</span>
        <div>
          {label&&<div style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',letterSpacing:'.16em',textTransform:'uppercase',marginBottom:4}}>{label}</div>}
          <h2 style={{fontFamily:'var(--fd-serif)',fontWeight:400,margin:0,fontSize:'clamp(24px,3vw,36px)',letterSpacing:'-0.02em',lineHeight:1.05,color:'var(--fd-ink1)'}}>{title}</h2>
        </div>
      </div>
      {right&&<div style={{fontFamily:'var(--fd-mono)',fontSize:10.5,color:'var(--fd-ink3)',letterSpacing:'.06em',flexShrink:0}}>{right}</div>}
    </motion.div>
  )
}

// ── Stat tile with hover coaching tip ─────────────────────────────────────────
function StatTile({idx,type,label,value,unit,dec=0,delta,spark}){
  const [hover,setHover]=useState(false)
  const tip=getStatTip(type,value,delta)
  const sparkPath=spark&&(()=>{
    const mn=Math.min(...spark),mx=Math.max(...spark),rng=mx-mn||1
    return spark.map((v,i)=>`${i===0?'M':'L'} ${((i/(spark.length-1))*100).toFixed(1)} ${(30-((v-mn)/rng)*28-1).toFixed(1)}`).join(' ')
  })()
  return(
    <motion.div initial={{opacity:0,y:20,scale:0.95}} animate={{opacity:1,y:0,scale:1}}
      transition={{type:'spring',stiffness:200,damping:22,delay:0.06+idx*0.08}}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{background:'var(--fd-surface)',border:`1px solid ${hover?'rgba(255,255,255,0.14)':'rgba(255,255,255,0.06)'}`,borderRadius:16,padding:'20px 20px 18px',position:'relative',overflow:'hidden',backdropFilter:'blur(12px)',cursor:'default',transition:'border-color .2s'}}>
      <div style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',letterSpacing:'.16em',textTransform:'uppercase'}}>{label}</div>
      <div style={{fontFamily:'var(--fd-serif)',fontSize:'clamp(36px,4vw,52px)',letterSpacing:'-0.025em',lineHeight:1,marginTop:12,color:'var(--fd-ink1)',display:'flex',alignItems:'baseline',gap:6}}>
        {value!=null?<CountUp to={value} dec={dec} dur={1.6}/>:'—'}
        {unit&&<span style={{fontFamily:'var(--fd-mono)',fontSize:11,color:'var(--fd-ink3)',letterSpacing:'.1em',textTransform:'uppercase'}}>{unit}</span>}
      </div>
      {delta&&(
        <div style={{marginTop:8,fontFamily:'var(--fd-mono)',fontSize:10.5,color:'var(--fd-ink3)',letterSpacing:'.04em'}}>
          vs prior week · <b style={{color:delta.up?'var(--good)':'var(--bad)',fontWeight:500}}>{delta.text}</b>
        </div>
      )}
      {sparkPath&&(
        <svg style={{position:'absolute',right:-2,bottom:0,height:44,width:'58%',pointerEvents:'none',opacity:.55}} viewBox="0 0 100 30" preserveAspectRatio="none">
          <motion.path d={sparkPath} fill="none" stroke="var(--fd-ink3)" strokeWidth="1.3"
            initial={{pathLength:0}} animate={{pathLength:1}} transition={{duration:1.4,delay:0.6+idx*0.08,ease:[0.2,0.7,0.2,1]}}/>
        </svg>
      )}
      {/* Coaching tip tooltip */}
      <AnimatePresence>
        {hover&&tip&&(
          <motion.div initial={{opacity:0,y:6,scale:0.97}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:4,scale:0.97}}
            transition={{duration:0.18,ease:[0.2,0.7,0.2,1]}}
            style={{position:'absolute',inset:0,background:'rgba(14,12,10,0.94)',backdropFilter:'blur(8px)',borderRadius:16,padding:'16px 18px',display:'flex',flexDirection:'column',justifyContent:'center',gap:8,zIndex:10}}>
            <div style={{fontFamily:'var(--fd-mono)',fontSize:10.5,color:ORANGE,letterSpacing:'.1em',textTransform:'uppercase'}}>{tip.head}</div>
            <div style={{fontSize:12.5,lineHeight:1.6,color:'var(--fd-ink2)'}}>{tip.body}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Weekly bar chart ──────────────────────────────────────────────────────────
function WeeklyBars({data}){
  const ref=useRef(null);const[w,setW]=useState(560)
  useEffect(()=>{if(!ref.current)return;const ro=new ResizeObserver(([e])=>setW(Math.max(280,e.contentRect.width)));ro.observe(ref.current);return()=>ro.disconnect()},[])
  const[hover,setHover]=useState(null)
  const h=260,pL=36,pR=12,pT=16,pB=30,iW=w-pL-pR,iH=h-pT-pB
  const mx=Math.max(10,...data.map(d=>d.total_km)),yMax=Math.ceil(mx/10)*10
  const bw=iW/data.length,ticks=[0,yMax/4,yMax/2,yMax*3/4,yMax]
  return(
    <div ref={ref} style={{position:'relative',minHeight:h}}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{display:'block',width:'100%',height:'auto',overflow:'visible'}}>
        {ticks.map((t,i)=>{const y=pT+iH-(t/yMax)*iH;return(
          <g key={i}><line x1={pL} x2={w-pR} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray={i===0?'':'2 4'}/>
          <text x={pL-8} y={y+3} textAnchor="end" fontFamily="var(--fd-mono)" fontSize="9.5" fill="var(--fd-ink3)" letterSpacing="0.04em">{Math.round(t)}</text></g>
        )})}
        {data.map((d,i)=>{
          const bh=(d.total_km/yMax)*iH,x=pL+i*bw+bw*0.22,bwidth=bw*0.56,y=pT+iH-bh
          return(
            <g key={i} style={{cursor:'pointer'}} onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)}>
              <rect x={pL+i*bw} y={pT} width={bw} height={iH} fill="transparent"/>
              <motion.g style={{transformOrigin:`${x+bwidth/2}px ${pT+iH}px`,transformBox:'view-box'}}
                initial={{scaleY:0,opacity:d.isCurrent?1:0.7}} animate={{scaleY:1,opacity:hover===i?1:d.isCurrent?1:0.7}}
                transition={{duration:0.7,delay:i*0.06,ease:[0.2,0.7,0.2,1]}}>
                <rect x={x} y={y} width={bwidth} height={Math.max(bh,1)} rx="3" fill={d.isCurrent?ORANGE:'rgba(255,255,255,0.2)'}/>
              </motion.g>
              {d.isCurrent&&<motion.text x={x+bwidth/2} y={y-8} textAnchor="middle" fontFamily="var(--fd-mono)" fontSize="10" fill={ORANGE} letterSpacing="0.06em" initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.7+i*0.06}}>{d.total_km.toFixed(1)}KM</motion.text>}
              <text x={x+bwidth/2} y={h-10} textAnchor="middle" fontFamily="var(--fd-mono)" fontSize="9.5" fill="var(--fd-ink3)" letterSpacing="0.04em">{d.label}</text>
            </g>
          )
        })}
      </svg>
      {hover!=null&&(
        <div style={{position:'absolute',background:'#0e0c0a',border:'1px solid rgba(255,255,255,0.1)',color:'var(--fd-ink1)',padding:'9px 12px',borderRadius:8,fontFamily:'var(--fd-mono)',fontSize:10.5,letterSpacing:'.04em',pointerEvents:'none',zIndex:10,whiteSpace:'nowrap',left:`${((pL+hover*bw+bw*0.5)/w)*100}%`,top:0,transform:'translate(-50%,-100%) translateY(-8px)',boxShadow:'0 12px 32px -8px rgba(0,0,0,0.7)'}}>
          <div style={{color:'var(--fd-ink3)',fontSize:10,marginBottom:5}}>Week of {data[hover].label}</div>
          <b style={{fontSize:14}}>{data[hover].total_km.toFixed(1)}</b> km
        </div>
      )}
    </div>
  )
}

// ── HRV/RHR dual trend ────────────────────────────────────────────────────────
function DualTrend({daily}){
  const ref=useRef(null);const[w,setW]=useState(560)
  useEffect(()=>{if(!ref.current)return;const ro=new ResizeObserver(([e])=>setW(Math.max(280,e.contentRect.width)));ro.observe(ref.current);return()=>ro.disconnect()},[])
  const[hover,setHover]=useState(null)
  if(!daily.length) return <div style={{height:260,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--fd-ink3)',fontFamily:'var(--fd-mono)',fontSize:11}}>No health data yet</div>
  const h=260,pL=36,pR=36,pT=24,pB=28,iW=w-pL-pR,iH=h-pT-pB
  const hrvV=daily.map(d=>d.hrv||0),rhrV=daily.map(d=>d.resting_hr||0)
  const hMin=Math.floor(Math.min(...hrvV)/5)*5-5,hMax=Math.ceil(Math.max(...hrvV)/5)*5+5
  const rMin=Math.floor(Math.min(...rhrV)/2)*2-2,rMax=Math.ceil(Math.max(...rhrV)/2)*2+2
  const xAt=i=>pL+(i/(daily.length-1||1))*iW
  const yH=v=>pT+iH-((v-hMin)/(hMax-hMin||1))*iH
  const yR=v=>pT+iH-((v-rMin)/(rMax-rMin||1))*iH
  const hPath=daily.map((d,i)=>`${i===0?'M':'L'} ${xAt(i).toFixed(2)} ${yH(d.hrv||0).toFixed(2)}`).join(' ')
  const rPath=daily.map((d,i)=>`${i===0?'M':'L'} ${xAt(i).toFixed(2)} ${yR(d.resting_hr||0).toFixed(2)}`).join(' ')
  const aPath=hPath+` L ${xAt(daily.length-1)} ${pT+iH} L ${xAt(0)} ${pT+iH} Z`
  return(
    <div ref={ref} style={{position:'relative',minHeight:h}} onMouseLeave={()=>setHover(null)}
      onMouseMove={e=>{const r=ref.current.getBoundingClientRect();const sx=(e.clientX-r.left)/r.width*w;let best=0,bd=Infinity;daily.forEach((_,i)=>{const dx=Math.abs(xAt(i)-sx);if(dx<bd){bd=dx;best=i}});setHover(best)}}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{display:'block',width:'100%',height:'auto',overflow:'visible'}}>
        <defs>
          <linearGradient id="fd-hrv-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--good)" stopOpacity="0.28"/>
            <stop offset="100%" stopColor="var(--good)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0,1,2,3].map(i=>{const y=pT+(i/3)*iH;return<line key={i} x1={pL} x2={w-pR} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray={i===3?'':'2 4'}/>})}
        <motion.path d={aPath} fill="url(#fd-hrv-area)" initial={{opacity:0}} animate={{opacity:1}} transition={{delay:1.2,duration:0.7}}/>
        <motion.path d={rPath} fill="none" stroke="var(--warn)" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="3 3" initial={{pathLength:0}} animate={{pathLength:1}} transition={{duration:1.6,ease:[0.2,0.7,0.2,1],delay:0.2}}/>
        <motion.path d={hPath} fill="none" stroke="var(--good)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" initial={{pathLength:0}} animate={{pathLength:1}} transition={{duration:1.6,ease:[0.2,0.7,0.2,1]}}/>
        {[hMin,(hMin+hMax)/2,hMax].map((v,i)=><text key={i} x={pL-6} y={yH(v)+3} textAnchor="end" fontFamily="var(--fd-mono)" fontSize="9.5" fill="var(--good)" opacity="0.8">{Math.round(v)}</text>)}
        {[rMin,(rMin+rMax)/2,rMax].map((v,i)=><text key={i} x={w-pR+6} y={yR(v)+3} textAnchor="start" fontFamily="var(--fd-mono)" fontSize="9.5" fill="var(--warn)" opacity="0.8">{Math.round(v)}</text>)}
        {hover!=null&&(
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={pT} y2={pT+iH} stroke="rgba(255,255,255,0.2)" strokeDasharray="2 3"/>
            <circle cx={xAt(hover)} cy={yH(daily[hover]?.hrv||0)} r="4" fill="#161412" stroke="var(--good)" strokeWidth="2"/>
            <circle cx={xAt(hover)} cy={yR(daily[hover]?.resting_hr||0)} r="4" fill="#161412" stroke="var(--warn)" strokeWidth="2"/>
          </g>
        )}
      </svg>
      {hover!=null&&daily[hover]&&(
        <div style={{position:'absolute',background:'#0e0c0a',border:'1px solid rgba(255,255,255,0.1)',color:'var(--fd-ink1)',padding:'10px 13px',borderRadius:8,fontFamily:'var(--fd-mono)',fontSize:10.5,pointerEvents:'none',zIndex:10,top:6,left:`${(xAt(hover)/w)*100}%`,transform:hover>daily.length*0.7?'translate(-100%,0)':hover<daily.length*0.2?'translate(0,0)':'translate(-50%,0)'}}>
          <div style={{color:'var(--fd-ink3)',fontSize:10,marginBottom:6}}>{new Date(daily[hover].date).toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'})}</div>
          <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:3}}><span style={{width:8,height:8,borderRadius:2,background:'var(--good)',display:'inline-block'}}/><span style={{color:'var(--fd-ink2)',flex:1}}>HRV</span><b>{daily[hover].hrv??'—'}</b> ms</div>
          <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:6}}><span style={{width:8,height:8,borderRadius:2,background:'var(--warn)',display:'inline-block'}}/><span style={{color:'var(--fd-ink2)',flex:1}}>Resting HR</span><b>{daily[hover].resting_hr??'—'}</b> bpm</div>
          {/* Context-aware micro-insight */}
          {daily[hover].hrv&&daily[hover].hrv<45&&<div style={{fontSize:10,color:'var(--bad)',borderTop:'1px solid rgba(255,255,255,0.06)',paddingTop:6,marginTop:2}}>→ Low HRV — take it easy today</div>}
          {daily[hover].hrv&&daily[hover].hrv>65&&<div style={{fontSize:10,color:'var(--good)',borderTop:'1px solid rgba(255,255,255,0.06)',paddingTop:6,marginTop:2}}>→ Well recovered — good day for quality work</div>}
          {daily[hover].resting_hr&&daily[hover].resting_hr>68&&<div style={{fontSize:10,color:'var(--warn)',borderTop:'1px solid rgba(255,255,255,0.06)',paddingTop:6,marginTop:2}}>→ Elevated HR — check hydration + sleep</div>}
        </div>
      )}
    </div>
  )
}

// ── 26-week heatmap ───────────────────────────────────────────────────────────
function Heatmap({cells,streakDays=new Set()}){
  const[tip,setTip]=useState(null)
  const grid=useMemo(()=>{
    const first=cells[0].dateObj,fd=first.getDay()===0?6:first.getDay()-1
    const cols=[],col=new Array(7).fill(null);let pos=fd
    for(let i=0;i<fd;i++)col[i]={empty:true}
    for(const c of cells){col[pos]=c;pos++;if(pos===7){cols.push([...col]);col.fill(null);pos=0}}
    if(pos>0)cols.push([...col])
    return cols
  },[cells])
  // Colour ramp: rest → faint → olive → green → bright-green → orange (streak)
  const maxCals=useMemo(()=>Math.max(150,...cells.map(c=>c.cals)),[cells])
  const iColor=(cals,inStreak)=>{
    if(cals<=0) return 'rgba(255,255,255,0.05)'
    if(inStreak) return ORANGE
    const t=Math.min(1,cals/maxCals)
    if(t<0.20) return 'oklch(38% 0.07 145)'
    if(t<0.45) return 'oklch(52% 0.13 145)'
    if(t<0.72) return 'oklch(65% 0.17 145)'
    return 'oklch(76% 0.20 130)'
  }
  const monthLabels=useMemo(()=>grid.map((col,ci)=>{const fr=col.find(c=>c&&!c.empty);if(!fr)return'';if(ci===0)return fr.dateObj.toLocaleString('en',{month:'short'});const pv=grid[ci-1].find(c=>c&&!c.empty);if(!pv)return'';return pv.dateObj.getMonth()!==fr.dateObj.getMonth()?fr.dateObj.toLocaleString('en',{month:'short'}):''}),[grid])
  const legendColors=['rgba(255,255,255,0.05)','oklch(38% 0.07 145)','oklch(52% 0.13 145)','oklch(65% 0.17 145)','oklch(76% 0.20 130)',ORANGE]
  return(
    <div style={{position:'relative',overflow:'hidden'}}>
      <div style={{overflowX:'auto',paddingBottom:6}}>
        <div style={{display:'grid',gridTemplateColumns:'24px 1fr',gap:6,minWidth:720}}>
          <div style={{display:'grid',gridTemplateRows:'repeat(7, 14px)',gap:3,fontFamily:'var(--fd-mono)',fontSize:9,color:'var(--fd-ink3)',paddingTop:14}}>
            {['','Mon','','Wed','','Fri',''].map((d,i)=><span key={i} style={{display:'flex',alignItems:'center',height:14}}>{d}</span>)}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:4}}>
            <div style={{display:'grid',gridTemplateColumns:`repeat(${grid.length},1fr)`,fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',height:14}}>
              {monthLabels.map((m,ci)=><span key={ci} style={{gridColumn:ci+1,whiteSpace:'nowrap'}}>{m}</span>)}
            </div>
            <div style={{display:'grid',gridTemplateColumns:`repeat(${grid.length},1fr)`,gap:3}}>
              {grid.map((col,ci)=>(
                <div key={ci} style={{display:'grid',gridTemplateRows:'repeat(7,14px)',gap:3}}>
                  {col.map((cell,ri)=>{
                    if(!cell||cell.empty)return<div key={ri} style={{width:'100%',height:14,borderRadius:3,background:'transparent'}}/>
                    const inStreak=streakDays.has(cell.date)
                    return(
                      <motion.div key={ri}
                        style={{width:'100%',height:14,borderRadius:3,
                          background:iColor(cell.cals,inStreak),
                          outline:inStreak?`1.5px solid ${ORANGE}`:'none',
                          outlineOffset:'-1px',
                          cursor:'pointer',
                          boxShadow:inStreak?`0 0 6px 1px ${ORANGE}60`:undefined}}
                        initial={{opacity:0,scale:0.4}} animate={{opacity:1,scale:1}}
                        transition={{duration:0.35,delay:ri*0.02+ci*0.012,ease:[0.2,0.7,0.2,1]}}
                        onMouseEnter={e=>{const r=e.currentTarget.getBoundingClientRect();const pr=e.currentTarget.closest('.fd-heatmap-wrap')?.getBoundingClientRect()||{left:0,top:0};setTip({cell,x:r.left-pr.left+r.width/2,y:r.top-pr.top})}}
                        onMouseLeave={()=>setTip(null)}
                        whileHover={{scale:1.4}}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:12,fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)'}}>
        <span>Last 26 weeks · colour by kcal/day · all activity types · 🔥 streak days</span>
        <div style={{display:'inline-flex',alignItems:'center',gap:6}}>
          <span>less</span>
          {legendColors.map((c,i)=>(
            <span key={i} style={{width:12,height:12,borderRadius:3,background:c,display:'inline-block',outline:i===5?`1.5px solid ${ORANGE}`:undefined,outlineOffset:i===5?'-1px':undefined}}/>
          ))}
          <span>more</span>
        </div>
      </div>
      {tip&&(
        <div style={{position:'absolute',background:'#0e0c0a',border:'1px solid rgba(255,255,255,0.1)',color:'var(--fd-ink1)',padding:'9px 12px',borderRadius:8,fontFamily:'var(--fd-mono)',fontSize:10.5,pointerEvents:'none',zIndex:10,whiteSpace:'nowrap',left:tip.x,top:tip.y-8,transform:'translate(-50%,-100%)'}}>
          <div style={{color:'var(--fd-ink3)',fontSize:10,marginBottom:4}}>
            {tip.cell.dateObj.toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'})}
            {streakDays.has(tip.cell.date)&&<span style={{color:ORANGE,marginLeft:6}}>🔥 streak</span>}
          </div>
          {tip.cell.acts.length===0?<span style={{color:'var(--fd-ink3)'}}>Rest day</span>:<><b>{Math.round(tip.cell.cals)}</b> kcal · <b>{Math.round(tip.cell.mins)}</b> min · {tip.cell.acts.map(a=>a.type).filter((v,i,s)=>s.indexOf(v)===i).join(', ')}</>}
        </div>
      )}
    </div>
  )
}

// ── Leaflet auto-fit helper ───────────────────────────────────────────────────
function FitBounds({coords}){
  const map=useMap()
  useEffect(()=>{
    if(!coords.length) return
    try { map.fitBounds(coords,{padding:[24,24]}) } catch(_){}
  },[]) // eslint-disable-line
  return null
}

// ── GIS insight panel ─────────────────────────────────────────────────────────
function GISPanel({gis,filter,routeCount}){
  const [tipKey,setTipKey]=useState(null)
  if(!gis) return <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:24,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--fd-ink3)',fontFamily:'var(--fd-mono)',fontSize:11}}>No route data</div>

  const tips={
    totalKm:{head:'Total mapped distance',body:'Every km on the map is real ground covered. Routes with GPS show pace, elevation, and effort across your entire history.'},
    cells:{head:'Unique zones explored',body:'Each zone is roughly 500m². Exploring new areas engages different muscles and prevents overuse patterns from flat or repeated loops.'},
    maxKm:{head:'Geographic range',body:'Expanding your range introduces terrain variety. Hilly routes build strength and improve VO₂max faster than flat loops.'},
    topCluster:{head:'Favourite starting zone',body:'Repeating known routes is great for measuring progress — time your standard loop monthly to track pace improvement on identical terrain.'},
    uniqueRoutes:{head:'Unique start zones',body:'Route variety reduces repetitive stress injury risk. Try one new start point per week for neuromuscular freshness.'},
    longest:{head:'Longest activity',body:'Long slow distance builds mitochondrial density and fat oxidation — the foundation of all endurance performance.'},
  }

  const Row=({k,label,value,sub})=>(
    <div onMouseEnter={()=>setTipKey(k)} onMouseLeave={()=>setTipKey(null)}
      style={{padding:'10px 0',borderBottom:'1px solid rgba(255,255,255,0.05)',cursor:'default',position:'relative'}}>
      <div style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase',marginBottom:3}}>{label}</div>
      <div style={{fontFamily:'var(--fd-serif)',fontSize:22,letterSpacing:'-0.02em',color:'var(--fd-ink1)'}}>{value}</div>
      {sub&&<div style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',marginTop:2}}>{sub}</div>}
      <AnimatePresence>
        {tipKey===k&&tips[k]&&(
          <motion.div initial={{opacity:0,x:-6}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-4}} transition={{duration:0.18}}
            style={{position:'absolute',right:0,top:0,bottom:0,left:'40%',background:'rgba(14,12,10,0.96)',backdropFilter:'blur(8px)',padding:'10px 12px',display:'flex',flexDirection:'column',gap:5,justifyContent:'center',zIndex:5,borderRadius:8}}>
            <div style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:ORANGE,letterSpacing:'.1em',textTransform:'uppercase'}}>{tips[k].head}</div>
            <div style={{fontSize:11.5,lineHeight:1.5,color:'var(--fd-ink2)'}}>{tips[k].body}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return(
    <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:'16px 18px',backdropFilter:'blur(12px)',overflow:'hidden'}}>
      <div style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',letterSpacing:'.16em',textTransform:'uppercase',marginBottom:12}}>GIS insights · {routeCount} routes</div>
      <Row k="totalKm"      label="Mapped distance" value={`${gis.totalKm} km`}/>
      <Row k="cells"        label="Zones explored"  value={gis.cells} sub="unique ~500m cells"/>
      <Row k="maxKm"        label="Farthest point"  value={`${gis.maxKm} km`} sub="from your centre"/>
      <Row k="uniqueRoutes" label="Start clusters"  value={gis.uniqueRoutes} sub="distinct launch zones"/>
      <Row k="topCluster"   label="Favourite zone"  value={`${gis.topCluster.length}×`} sub={gis.topCluster[0]?.name?.slice(0,22)||'repeated route'}/>
      {gis.longest&&<Row k="longest" label="Longest activity" value={`${(gis.longest.distance_m/1000).toFixed(1)} km`} sub={gis.longest.name?.slice(0,22)||gis.longest.type}/>}
    </div>
  )
}

// ── Route map ─────────────────────────────────────────────────────────────────
function RouteMap({routes}){
  const [filter,setFilter]=useState('all')
  const [hovered,setHovered]=useState(null)

  const decoded=useMemo(()=>routes.map(r=>({
    ...r,
    coords:r.polyline?simplifyPath(decodePolyline(r.polyline),0.0002):null,
    color:TC[r.type]||ORANGE,
  })).filter(r=>r.coords?.length),[routes])

  const filtered=filter==='all'?decoded:decoded.filter(r=>r.type===filter)

  // Always open on Vancouver (Sunset Beach). User can pan/zoom freely.
  const VANCOUVER = [49.2866, -123.1431]

  // All coords kept for GIS but no longer used to auto-fit the map
  const allCoords=useMemo(()=>filtered.flatMap(r=>r.coords),[filtered])

  const gis=useMemo(()=>computeGIS(routes),[routes])

  const typesAvailable=[...new Set(decoded.map(r=>r.type))]
  const routeCounts={all:decoded.length,...typesAvailable.reduce((c,t)=>{c[t]=decoded.filter(r=>r.type===t).length;return c},{})}

  return(
    <div style={{display:'grid',gap:14,gridTemplateColumns:'1fr 280px'}}>
      {/* Map */}
      <div style={{position:'relative',borderRadius:16,overflow:'hidden',height:480}}>
        {/* Filter pills */}
        <div style={{position:'absolute',top:12,left:12,zIndex:1000,display:'flex',gap:5,flexWrap:'wrap'}}>
          {(['all',...typesAvailable]).map(t=>(
            <button key={t} onClick={()=>setFilter(t)}
              style={{fontFamily:'var(--fd-mono)',fontSize:9.5,letterSpacing:'.12em',textTransform:'uppercase',padding:'5px 11px',borderRadius:999,border:'1px solid rgba(255,255,255,0.15)',cursor:'pointer',transition:'all .18s',
                background:filter===t?(TC[t]||ORANGE):'rgba(14,12,10,0.85)',
                color:filter===t?'#0e0c0a':'rgba(255,255,255,0.7)',backdropFilter:'blur(8px)'}}>
              {t==='all'?`All (${decoded.length})`:`${t} (${routeCounts[t]||0})`}
            </button>
          ))}
        </div>
        {/* Activity count badge */}
        <div style={{position:'absolute',bottom:12,left:12,zIndex:1000,fontFamily:'var(--fd-mono)',fontSize:10,color:'rgba(255,255,255,0.5)',background:'rgba(14,12,10,0.75)',backdropFilter:'blur(6px)',padding:'4px 10px',borderRadius:999,border:'1px solid rgba(255,255,255,0.08)'}}>
          {filtered.length} route{filtered.length!==1?'s':''} shown
        </div>
        <MapContainer center={VANCOUVER} zoom={13} style={{height:'100%',width:'100%',background:'#0e0c0a'}}
          zoomControl={true} attributionControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution="© OpenStreetMap contributors © CARTO" maxZoom={19}/>
          {filtered.map(r=>(
            <Polyline key={r.id} positions={r.coords}
              pathOptions={{color:hovered===r.id?'#ffffff':r.color,weight:hovered===r.id?3.5:2,opacity:hovered===r.id?1:0.65,lineCap:'round',lineJoin:'round'}}
              eventHandlers={{
                mouseover:()=>setHovered(r.id),
                mouseout: ()=>setHovered(null),
              }}
            />
          ))}
        </MapContainer>
      </div>
      {/* GIS panel */}
      <GISPanel gis={gis} filter={filter} routeCount={filtered.length}/>
    </div>
  )
}

// ── Sport figures ─────────────────────────────────────────────────────────────
const skin='#e8b896',hair='#3d2418',shoe='#1a1a1a'
function Runner(){const c=TC.run;return(
  <svg viewBox="0 0 280 280" width="280" height="280">
    <motion.ellipse cx="140" cy="246" rx="46" ry="4" fill="rgba(0,0,0,0.5)" animate={{rx:[46,40,46],opacity:[0.5,0.3,0.5]}} transition={{duration:0.55,repeat:Infinity,ease:'easeInOut'}}/>
    <line x1="20" y1="240" x2="260" y2="240" stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="2 4"/>
    <motion.g animate={{y:[0,-9,0]}} transition={{duration:0.55,repeat:Infinity,ease:'easeInOut'}}>
      <path d="M132 110 L148 110 L154 175 L126 175 Z" fill={c} stroke="#0e0c0a" strokeWidth="2"/>
      <rect x="135" y="100" width="10" height="14" fill={skin}/>
      <circle cx="140" cy="90" r="18" fill={skin} stroke="#0e0c0a" strokeWidth="2"/>
      <path d="M122 86 Q124 70 140 70 Q156 70 158 86 Q158 80 140 78 Q122 80 122 86 Z" fill={hair}/>
      <circle cx="148" cy="89" r="1.6" fill="#0e0c0a"/>
      <path d="M146 84 L152 85" stroke="#0e0c0a" strokeWidth="1.6" strokeLinecap="round"/>
      <rect x="121" y="84" width="38" height="4" fill={c} stroke="#0e0c0a" strokeWidth="1.2"/>
      <motion.g style={{transformOrigin:'132px 118px'}} animate={{rotate:[-55,35,-55]}} transition={{duration:0.55,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="124" y="116" width="8" height="36" rx="4" fill={skin} stroke="#0e0c0a" strokeWidth="1.6"/>
        <rect x="124" y="148" width="8" height="30" rx="4" fill={c} stroke="#0e0c0a" strokeWidth="1.6"/>
        <circle cx="128" cy="180" r="5" fill={skin} stroke="#0e0c0a" strokeWidth="1.4"/>
      </motion.g>
      <motion.g style={{transformOrigin:'148px 118px'}} animate={{rotate:[35,-55,35]}} transition={{duration:0.55,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="148" y="116" width="8" height="36" rx="4" fill={skin} stroke="#0e0c0a" strokeWidth="1.6"/>
        <rect x="148" y="148" width="8" height="30" rx="4" fill={c} stroke="#0e0c0a" strokeWidth="1.6"/>
        <circle cx="152" cy="180" r="5" fill={skin} stroke="#0e0c0a" strokeWidth="1.4"/>
      </motion.g>
    </motion.g>
    <motion.g style={{transformOrigin:'134px 178px'}} animate={{rotate:[40,-50,40]}} transition={{duration:0.55,repeat:Infinity,ease:'easeInOut'}}>
      <rect x="128" y="176" width="12" height="40" rx="5" fill="#1a1714" stroke="#0e0c0a" strokeWidth="1.6"/>
      <rect x="124" y="214" width="22" height="10" rx="3" fill={shoe} stroke="#0e0c0a" strokeWidth="1.6"/>
      <rect x="124" y="222" width="22" height="3" fill={c}/>
    </motion.g>
    <motion.g style={{transformOrigin:'146px 178px'}} animate={{rotate:[-50,40,-50]}} transition={{duration:0.55,repeat:Infinity,ease:'easeInOut'}}>
      <rect x="140" y="176" width="12" height="40" rx="5" fill="#1a1714" stroke="#0e0c0a" strokeWidth="1.6"/>
      <rect x="134" y="214" width="22" height="10" rx="3" fill={shoe} stroke="#0e0c0a" strokeWidth="1.6"/>
      <rect x="134" y="222" width="22" height="3" fill={c}/>
    </motion.g>
    <motion.g animate={{x:[-30,60],opacity:[0,0.7,0]}} transition={{duration:0.7,repeat:Infinity,ease:'linear'}}>
      <line x1="60" y1="180" x2="100" y2="180" stroke="rgba(255,255,255,0.3)" strokeWidth="1.2"/>
      <line x1="70" y1="200" x2="110" y2="200" stroke="rgba(255,255,255,0.25)" strokeWidth="1.2"/>
    </motion.g>
  </svg>
)}
function Cyclist(){const c=TC.ride;return(
  <svg viewBox="0 0 280 280" width="280" height="280">
    <motion.ellipse cx="140" cy="246" rx="46" ry="4" fill="rgba(0,0,0,0.5)" animate={{rx:[46,40,46]}} transition={{duration:0.6,repeat:Infinity,ease:'easeInOut'}}/>
    <g stroke="#f7f5f1" strokeWidth="3" fill="none" strokeLinecap="round">
      <path d="M80 220 L140 220 L160 160 L80 220"/><path d="M200 220 L140 220 L160 160"/>
      <line x1="160" y1="160" x2="170" y2="120"/><line x1="160" y1="160" x2="125" y2="148"/><line x1="125" y1="148" x2="115" y2="120"/>
    </g>
    <rect x="170" y="110" width="22" height="4" rx="2" fill="#f7f5f1"/><rect x="110" y="115" width="22" height="6" rx="3" fill="#f7f5f1"/>
    {[{cx:80},{cx:200}].map(({cx},i)=>(
      <motion.g key={i} style={{transformOrigin:`${cx}px 220px`}} animate={{rotate:360}} transition={{duration:0.6,repeat:Infinity,ease:'linear'}}>
        <circle cx={cx} cy="220" r="32" fill="none" stroke="#f7f5f1" strokeWidth="3"/>
        <circle cx={cx} cy="220" r="3" fill="#f7f5f1"/>
        <line x1={cx} y1="190" x2={cx} y2="250" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2"/>
        <line x1={cx-30} y1="220" x2={cx+30} y2="220" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2"/>
      </motion.g>
    ))}
    <motion.g animate={{y:[0,-1,0]}} transition={{duration:0.6,repeat:Infinity,ease:'easeInOut'}}>
      <path d="M118 150 L168 118 L176 128 L126 162 Z" fill={c} stroke="#0e0c0a" strokeWidth="2"/>
      <circle cx="178" cy="110" r="14" fill={skin} stroke="#0e0c0a" strokeWidth="2"/>
      <path d="M166 104 Q170 92 186 92 Q198 96 192 110 L188 110 Q190 100 178 100 Q170 102 166 110 Z" fill={c} stroke="#0e0c0a" strokeWidth="1.6"/>
    </motion.g>
  </svg>
)}
function Walker(){const c=TC.walk;return(
  <svg viewBox="0 0 280 280" width="280" height="280">
    <motion.ellipse cx="140" cy="246" rx="38" ry="4" fill="rgba(0,0,0,0.45)" animate={{rx:[38,34,38]}} transition={{duration:0.9,repeat:Infinity,ease:'easeInOut'}}/>
    <motion.g animate={{y:[0,-4,0]}} transition={{duration:0.9,repeat:Infinity,ease:'easeInOut'}}>
      <circle cx="140" cy="80" r="18" fill={skin} stroke="#0e0c0a" strokeWidth="2"/>
      <path d="M122 76 Q124 60 140 60 Q156 60 158 76 Q158 70 140 68 Q122 70 122 76 Z" fill={hair}/>
      <rect x="136" y="96" width="8" height="14" fill={skin}/>
      <rect x="128" y="108" width="24" height="50" rx="8" fill={c} stroke="#0e0c0a" strokeWidth="2"/>
      <motion.g style={{transformOrigin:'132px 120px'}} animate={{rotate:[-28,12,-28]}} transition={{duration:0.9,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="126" y="116" width="8" height="34" rx="4" fill={skin} stroke="#0e0c0a" strokeWidth="1.5"/>
      </motion.g>
      <motion.g style={{transformOrigin:'148px 120px'}} animate={{rotate:[12,-28,12]}} transition={{duration:0.9,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="146" y="116" width="8" height="34" rx="4" fill={skin} stroke="#0e0c0a" strokeWidth="1.5"/>
      </motion.g>
    </motion.g>
    <motion.g style={{transformOrigin:'134px 162px'}} animate={{rotate:[-18,22,-18]}} transition={{duration:0.9,repeat:Infinity,ease:'easeInOut'}}>
      <rect x="128" y="158" width="10" height="38" rx="5" fill="#1a1714" stroke="#0e0c0a" strokeWidth="1.5"/>
      <rect x="122" y="193" width="20" height="9" rx="3" fill={shoe} stroke="#0e0c0a" strokeWidth="1.5"/>
    </motion.g>
    <motion.g style={{transformOrigin:'146px 162px'}} animate={{rotate:[22,-18,22]}} transition={{duration:0.9,repeat:Infinity,ease:'easeInOut'}}>
      <rect x="142" y="158" width="10" height="38" rx="5" fill="#1a1714" stroke="#0e0c0a" strokeWidth="1.5"/>
      <rect x="138" y="193" width="20" height="9" rx="3" fill={shoe} stroke="#0e0c0a" strokeWidth="1.5"/>
    </motion.g>
  </svg>
)}
function Weightlifter(){const c=TC.strength;return(
  <svg viewBox="0 0 280 280" width="280" height="280">
    <motion.ellipse cx="140" cy="246" rx="44" ry="4" fill="rgba(0,0,0,0.5)" animate={{rx:[44,42,44]}} transition={{duration:1.2,repeat:Infinity,ease:'easeInOut'}}/>
    <motion.g animate={{y:[0,-6,0]}} transition={{duration:1.2,repeat:Infinity,ease:'easeInOut'}}>
      <circle cx="140" cy="82" r="20" fill={skin} stroke="#0e0c0a" strokeWidth="2"/>
      <path d="M120 78 Q122 60 140 58 Q158 60 160 78 Q158 70 140 68 Q122 70 120 78 Z" fill={hair}/>
      <rect x="130" y="98" width="20" height="60" rx="10" fill={c} stroke="#0e0c0a" strokeWidth="2"/>
      {/* Barbell */}
      <motion.g animate={{y:[0,-4,0],rotate:[0,-2,0]}} transition={{duration:1.2,repeat:Infinity,ease:'easeInOut'}} style={{transformOrigin:'140px 130px'}}>
        <rect x="60" y="126" width="160" height="8" rx="4" fill="#888"/>
        <rect x="56" y="116" width="20" height="28" rx="4" fill="#555"/>
        <rect x="40" y="120" width="20" height="20" rx="4" fill="#444"/>
        <rect x="204" y="116" width="20" height="28" rx="4" fill="#555"/>
        <rect x="220" y="120" width="20" height="20" rx="4" fill="#444"/>
      </motion.g>
      <motion.g style={{transformOrigin:'118px 118px'}} animate={{rotate:[-30,10,-30]}} transition={{duration:1.2,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="112" y="112" width="8" height="40" rx="4" fill={skin} stroke="#0e0c0a" strokeWidth="1.6"/>
      </motion.g>
      <motion.g style={{transformOrigin:'162px 118px'}} animate={{rotate:[30,-10,30]}} transition={{duration:1.2,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="160" y="112" width="8" height="40" rx="4" fill={skin} stroke="#0e0c0a" strokeWidth="1.6"/>
      </motion.g>
      <rect x="122" y="160" width="14" height="42" rx="5" fill="#1a1714" stroke="#0e0c0a" strokeWidth="1.5"/>
      <rect x="144" y="160" width="14" height="42" rx="5" fill="#1a1714" stroke="#0e0c0a" strokeWidth="1.5"/>
      <rect x="115" y="197" width="24" height="9" rx="3" fill={shoe}/>
      <rect x="141" y="197" width="24" height="9" rx="3" fill={shoe}/>
    </motion.g>
  </svg>
)}
function Yogi(){const c=TC.yoga;return(
  <svg viewBox="0 0 280 280" width="280" height="280">
    <motion.ellipse cx="140" cy="242" rx="50" ry="5" fill="rgba(0,0,0,0.35)" animate={{rx:[50,46,50]}} transition={{duration:3,repeat:Infinity,ease:'easeInOut'}}/>
    <motion.g animate={{y:[0,-3,0]}} transition={{duration:3,repeat:Infinity,ease:'easeInOut'}}>
      <circle cx="140" cy="76" r="18" fill={skin} stroke="#0e0c0a" strokeWidth="2"/>
      <path d="M122 72 Q124 56 140 54 Q156 56 158 72" fill={hair}/>
      <rect x="132" y="90" width="16" height="50" rx="8" fill={c} stroke="#0e0c0a" strokeWidth="2"/>
      <motion.g style={{transformOrigin:'132px 106px'}} animate={{rotate:[-70,70,-70]}} transition={{duration:3,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="124" y="100" width="8" height="38" rx="4" fill={skin} stroke="#0e0c0a" strokeWidth="1.5"/>
        <circle cx="128" cy="140" r="5" fill={skin} stroke="#0e0c0a" strokeWidth="1.3"/>
      </motion.g>
      <motion.g style={{transformOrigin:'148px 106px'}} animate={{rotate:[70,-70,70]}} transition={{duration:3,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="148" y="100" width="8" height="38" rx="4" fill={skin} stroke="#0e0c0a" strokeWidth="1.5"/>
        <circle cx="152" cy="140" r="5" fill={skin} stroke="#0e0c0a" strokeWidth="1.3"/>
      </motion.g>
      <motion.g style={{transformOrigin:'134px 148px'}} animate={{rotate:[-45,0,-45]}} transition={{duration:3,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="128" y="140" width="10" height="40" rx="5" fill={c} stroke="#0e0c0a" strokeWidth="1.5"/>
        <rect x="120" y="177" width="22" height="8" rx="3" fill={shoe}/>
      </motion.g>
      <motion.g style={{transformOrigin:'146px 148px'}} animate={{rotate:[45,0,45]}} transition={{duration:3,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="142" y="140" width="10" height="40" rx="5" fill={c} stroke="#0e0c0a" strokeWidth="1.5"/>
        <rect x="138" y="177" width="22" height="8" rx="3" fill={shoe}/>
      </motion.g>
      <motion.circle cx="140" cy="76" r="24" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="3 4" opacity="0.4" animate={{rotate:360}} transition={{duration:6,repeat:Infinity,ease:'linear'}}/>
    </motion.g>
  </svg>
)}
function HIITFigure(){const c=TC.hiit;return(
  <svg viewBox="0 0 280 280" width="280" height="280">
    <motion.ellipse cx="140" cy="246" rx="42" ry="4" fill="rgba(0,0,0,0.5)" animate={{rx:[42,36,42]}} transition={{duration:0.4,repeat:Infinity,ease:'easeInOut'}}/>
    <motion.g animate={{y:[0,-14,0],scaleY:[1,1.04,1]}} transition={{duration:0.4,repeat:Infinity,ease:'easeInOut'}}>
      <circle cx="140" cy="82" r="18" fill={skin} stroke="#0e0c0a" strokeWidth="2"/>
      <path d="M122 78 Q124 62 140 60 Q156 62 158 78" fill={hair}/>
      <rect x="128" y="96" width="24" height="52" rx="10" fill={c} stroke="#0e0c0a" strokeWidth="2"/>
      <motion.g style={{transformOrigin:'128px 112px'}} animate={{rotate:[-80,40,-80]}} transition={{duration:0.4,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="120" y="106" width="8" height="30" rx="4" fill={skin} stroke="#0e0c0a" strokeWidth="1.5"/>
      </motion.g>
      <motion.g style={{transformOrigin:'152px 112px'}} animate={{rotate:[40,-80,40]}} transition={{duration:0.4,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="152" y="106" width="8" height="30" rx="4" fill={skin} stroke="#0e0c0a" strokeWidth="1.5"/>
      </motion.g>
      <motion.g style={{transformOrigin:'132px 152px'}} animate={{rotate:[60,-60,60]}} transition={{duration:0.4,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="126" y="148" width="10" height="36" rx="5" fill="#1a1714" stroke="#0e0c0a" strokeWidth="1.5"/>
        <rect x="118" y="180" width="22" height="9" rx="3" fill={shoe}/>
      </motion.g>
      <motion.g style={{transformOrigin:'148px 152px'}} animate={{rotate:[-60,60,-60]}} transition={{duration:0.4,repeat:Infinity,ease:'easeInOut'}}>
        <rect x="144" y="148" width="10" height="36" rx="5" fill="#1a1714" stroke="#0e0c0a" strokeWidth="1.5"/>
        <rect x="140" y="180" width="22" height="9" rx="3" fill={shoe}/>
      </motion.g>
    </motion.g>
    {[0,1,2].map(i=>(
      <motion.circle key={i} cx={110+i*20} cy="240" r="3" fill={c} opacity="0.6"
        animate={{y:[0,-10,0],opacity:[0.6,0,0.6]}} transition={{duration:0.4,delay:i*0.13,repeat:Infinity}}/>
    ))}
  </svg>
)}

const FIGURES={run:Runner,ride:Cyclist,swim:Yogi,strength:Weightlifter,yoga:Yogi,hiit:HIITFigure,walk:Walker,hike:Walker,workout:HIITFigure,cardio:HIITFigure,all:Runner}

// ── Focus stage ───────────────────────────────────────────────────────────────
function FocusStage({tab,weekActs}){
  const Figure=FIGURES[tab]||Runner
  const list=tab==='all'?weekActs:weekActs.filter(a=>a.type===tab)
  const km=+(list.reduce((s,a)=>s+(a.distance_m||0),0)/1000).toFixed(1)
  const mins=Math.round(list.reduce((s,a)=>s+(a.duration_secs||0),0)/60)
  const color=tab==='all'?ORANGE:(TC[tab]||ORANGE)
  return(
    <div style={{background:'linear-gradient(180deg,var(--fd-surface) 0%,#1a1714 100%)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:18,height:360,position:'relative',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{position:'absolute',left:0,right:0,bottom:'34%',height:1,background:'rgba(255,255,255,0.08)'}}/>
      <div style={{position:'absolute',top:16,left:18,fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',letterSpacing:'.16em',textTransform:'uppercase'}}>
        Activity focus · <b style={{color:'var(--fd-ink1)',fontWeight:500}}>{FIGURE_LABEL[tab]||'All'}</b>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{opacity:0,scale:0.88,y:12}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:0.92,y:-8}} transition={{duration:0.4,ease:[0.2,0.7,0.2,1]}} style={{width:280,height:280}}>
          <Figure/>
        </motion.div>
      </AnimatePresence>
      <div style={{position:'absolute',bottom:16,left:18,right:18,display:'flex',justifyContent:'space-between',gap:14,fontFamily:'var(--fd-mono)',fontSize:10.5,color:'var(--fd-ink3)'}}>
        <span><b style={{color:'var(--fd-ink1)',fontSize:13,marginRight:5}}>{list.length}</b>sessions</span>
        {km>0&&<span><b style={{color:'var(--fd-ink1)',fontSize:13,marginRight:5}}>{km}</b>km</span>}
        <span><b style={{color:'var(--fd-ink1)',fontSize:13,marginRight:5}}>{mins}</b>min</span>
        <span style={{color}}>{FIGURE_LABEL[tab]||'All'}</span>
      </div>
    </div>
  )
}

// ── Sport tabs ────────────────────────────────────────────────────────────────
function SportTabs({value,onChange,counts}){
  const cRef=useRef(null)
  const[ind,setInd]=useState({left:0,width:0,opacity:0})
  useEffect(()=>{
    if(!cRef.current)return
    const active=cRef.current.querySelector('[data-active="true"]')
    if(!active)return
    const cr=cRef.current.getBoundingClientRect(),ar=active.getBoundingClientRect()
    setInd({left:ar.left-cr.left+cRef.current.scrollLeft,width:ar.width,opacity:1})
  },[value])
  return(
    <div ref={cRef} style={{display:'flex',gap:4,padding:4,border:'1px solid rgba(255,255,255,0.06)',borderRadius:12,background:'var(--fd-surface)',overflowX:'auto',position:'relative',flexShrink:0}}>
      <div style={{position:'absolute',top:4,bottom:4,left:ind.left,width:ind.width,background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,opacity:ind.opacity,transition:'left .35s cubic-bezier(.34,1.1,.64,1), width .35s cubic-bezier(.34,1.1,.64,1)',pointerEvents:'none',zIndex:0}}/>
      {TAB_OPTS.map(opt=>(
        <button key={opt.k} data-active={value===opt.k} onClick={()=>onChange(opt.k)}
          style={{padding:'8px 14px',borderRadius:8,fontFamily:'var(--fd-mono)',fontSize:11,letterSpacing:'.14em',textTransform:'uppercase',color:value===opt.k?'var(--fd-ink1)':'var(--fd-ink3)',position:'relative',zIndex:1,display:'flex',alignItems:'center',gap:6,whiteSpace:'nowrap',transition:'color .2s',background:'transparent',border:'none',cursor:'pointer'}}>
          <span style={{width:6,height:6,borderRadius:'50%',background:opt.k==='all'?'rgba(255,255,255,0.4)':(TC[opt.k]||ORANGE),display:'inline-block'}}/>
          {opt.l}
          {counts?.[opt.k]!=null&&<span style={{color:'var(--fd-ink3)',marginLeft:3}}>{counts[opt.k]}</span>}
        </button>
      ))}
    </div>
  )
}

// ── Goals ─────────────────────────────────────────────────────────────────────
function goalStatus(g) {
  const pct  = (g.current || 0) / (g.target_value || 1)
  if (pct >= 1) return 'done'
  if (!g.target_date) return pct >= 0.5 ? 'on-track' : 'behind'   // week goals have no date
  const now   = new Date()
  const due   = new Date(g.target_date + 'T23:59:59')
  if (now > due) return 'overdue'
  // For month goals: compare progress % to elapsed month %
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthTotal = due - monthStart
  const elapsed    = now - monthStart
  const expected   = monthTotal > 0 ? Math.max(0, elapsed / monthTotal) : 1
  return pct < expected - 0.12 ? 'behind' : 'on-track'
}

function Goals({goals}) {
  return (
    <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:12}}>
      {goals.map((g, i) => {
        const st  = goalStatus(g)
        const col = st === 'done' ? 'var(--good)' : st === 'overdue' ? 'var(--bad)' : st === 'behind' ? 'var(--warn)' : 'var(--good)'
        const pct = Math.min(1, (g.current || 0) / (g.target_value || 1))
        const typeColor = TC[g.type] || ORANGE

        // Format current/target sensibly
        const fmt = v => g.unit === 'lbs' ? Math.round(v).toLocaleString()
          : g.unit === 'km'   ? v.toFixed(1)
          : String(Math.round(v))

        return (
          <motion.div key={g.slug ?? g.id}
            initial={{opacity:0, y:12}} whileInView={{opacity:1, y:0}}
            viewport={{once:true, amount:0.4}}
            transition={{duration:0.45, delay:i*0.08, ease:[0.2,0.7,0.2,1]}}
            style={{
              background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)',
              borderRadius:14, padding:16, display:'flex', flexDirection:'column', gap:10,
            }}>

            {/* Title + status badge */}
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8}}>
              <div style={{fontSize:12.5, lineHeight:1.35, color:'var(--fd-ink1)', flex:1}}>{g.title}</div>
              <span style={{
                fontFamily:'var(--fd-mono)', fontSize:8.5, letterSpacing:'.08em', textTransform:'uppercase',
                padding:'2px 7px', borderRadius:4, flexShrink:0,
                background: `${col}22`, color: col, border:`1px solid ${col}44`,
              }}>
                {st === 'done' ? '✓ Done' : st === 'on-track' ? 'On track' : st === 'behind' ? 'Behind' : st === 'overdue' ? 'Overdue' : st}
              </span>
            </div>

            {/* Progress bar */}
            <div style={{height:6, borderRadius:3, background:'rgba(255,255,255,0.08)', overflow:'hidden'}}>
              <motion.div
                initial={{width:0}} whileInView={{width:`${pct*100}%`}}
                viewport={{once:true}} transition={{duration:0.9, delay:0.2+i*0.08, ease:[0.2,0.7,0.2,1]}}
                style={{height:'100%', borderRadius:3, background: pct >= 1 ? 'var(--good)' : typeColor}}/>
            </div>

            {/* Numbers + date */}
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
              <div style={{fontFamily:'var(--fd-mono)', fontSize:10.5, color:'var(--fd-ink3)'}}>
                <b style={{color:'var(--fd-ink1)', fontSize:13}}>{fmt(g.current || 0)}</b>
                <span style={{marginLeft:4}}>/  {fmt(g.target_value)} {g.unit}</span>
              </div>
              <div style={{fontFamily:'var(--fd-mono)', fontSize:10, color:'var(--fd-ink3)'}}>
                {g.target_date
                  ? (() => {
                      const days = Math.ceil((new Date(g.target_date+'T23:59:59') - new Date()) / 86400000)
                      return days > 0 ? `${days}d left` : 'ended'
                    })()
                  : `${Math.round(pct*100)}%`}
              </div>
            </div>

          </motion.div>
        )
      })}
    </div>
  )
}

// ── Training plan ─────────────────────────────────────────────────────────────
function Plan({plan}){
  const todayDow=new Date().getDay()===0?6:new Date().getDay()-1
  const weekStart=new Date(plan.week_start+'T00:00:00')
  return(
    <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:10}}>
      {DAYS_KEY.map((day,i)=>{
        const item=plan.plan[day],isToday=i===todayDow,isPast=i<todayDow
        const date=new Date(weekStart);date.setDate(date.getDate()+i)
        const color=item?(TC[item.type]||ORANGE):'rgba(255,255,255,0.2)'
        return(
          <motion.div key={day} initial={{opacity:0,y:14,scale:isToday?0.92:0.96}} whileInView={{opacity:1,y:0,scale:isToday?1.04:1}} viewport={{once:true,amount:0.2}}
            transition={{type:'spring',stiffness:220,damping:22,delay:0.1+i*0.06}}
            style={{background:isToday?`linear-gradient(180deg,${ORANGE}10,rgba(255,255,255,0.02) 60%)`:'rgba(255,255,255,0.02)',border:`1px solid ${isToday?ORANGE:'rgba(255,255,255,0.06)'}`,borderRadius:12,padding:'14px 12px',display:'flex',flexDirection:'column',gap:8,position:'relative',minHeight:160,boxShadow:isToday?`0 12px 36px -16px ${ORANGE}50`:undefined}}>
            <span style={{position:'absolute',left:0,top:14,bottom:14,width:3,borderRadius:2,background:color}}/>
            <div style={{fontFamily:'var(--fd-mono)',fontSize:10,color:isToday?ORANGE:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase'}}>{DAYS_ABBR[i]}</div>
            <div style={{fontFamily:'var(--fd-serif)',fontSize:22,letterSpacing:'-0.02em',lineHeight:1,color:'var(--fd-ink1)'}}>{date.getDate()}</div>
            {isPast&&item&&(
              <div style={{position:'absolute',top:12,right:12,width:18,height:18,borderRadius:'50%',background:'var(--good)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="11" height="11" viewBox="0 0 14 14">
                  <motion.path d="M2.5 7.5 L5.5 10.5 L11.5 4" fill="none" stroke="#0e0c0a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" initial={{pathLength:0}} whileInView={{pathLength:1}} viewport={{once:true}} transition={{duration:0.5,delay:0.6+i*0.06}}/>
                </svg>
              </div>
            )}
            {item?(
              <>
                <div style={{marginTop:'auto'}}>
                  <span style={{color,fontFamily:'var(--fd-mono)',fontSize:10,letterSpacing:'.14em',textTransform:'uppercase'}}>{item.type}</span>
                  <div style={{fontFamily:'var(--fd-mono)',fontSize:10.5,color:'var(--fd-ink3)',marginTop:2}}>{item.durationMins} min</div>
                </div>
                <div style={{fontSize:11,color:'var(--fd-ink3)',lineHeight:1.4}}>{item.notes}</div>
              </>
            ):(
              <div style={{marginTop:'auto',color:'var(--fd-ink3)',fontSize:13}}>Rest</div>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

// ── Insight card ──────────────────────────────────────────────────────────────
function InsightCard({ insight, workouts = [], exercisePRs = {}, bodyweightLbs }){
  const [tab, setTab] = useState('endurance')
  return(
    <motion.div initial={{opacity:0,y:24}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:0.3}} transition={{duration:0.6,ease:[0.2,0.7,0.2,1]}}
      style={{background:'linear-gradient(180deg,var(--fd-surface) 0%,#1a1714 100%)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:18,padding:22,height:'100%',overflowY:'auto',boxSizing:'border-box'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
        <div style={{display:'inline-flex',gap:3,background:'rgba(255,255,255,0.04)',borderRadius:8,padding:3}}>
          {[{k:'endurance',l:'Coach notes'},{k:'strength',l:'Strength lab'}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)}
              style={{fontFamily:'var(--fd-mono)',fontSize:10,letterSpacing:'.08em',padding:'4px 10px',borderRadius:6,border:'none',cursor:'pointer',transition:'all .18s',
                background:tab===t.k?'rgba(255,255,255,0.12)':'transparent',
                color:tab===t.k?'var(--fd-ink1)':'var(--fd-ink3)'}}>
              {t.l}
            </button>
          ))}
        </div>
        <span style={{fontFamily:'var(--fd-mono)',fontSize:10,color:ORANGE}}>● {new Date(insight.week_start+'T00:00:00').toLocaleDateString('en',{month:'short',day:'numeric'})}</span>
      </div>
      {tab==='endurance'&&(
        <>
          <p style={{fontFamily:'var(--fd-serif)',fontSize:'clamp(16px,2.2vw,20px)',letterSpacing:'-0.015em',lineHeight:1.35,color:'var(--fd-ink1)',margin:'0 0 16px'}}>
            <em style={{color:ORANGE}}>{insight.summary}</em>
          </p>
          <ul style={{margin:0,padding:0,listStyle:'none',display:'flex',flexDirection:'column',gap:10}}>
            {insight.insights?.list?.map((s,i)=>(
              <motion.li key={i} initial={{opacity:0,x:-10}} whileInView={{opacity:1,x:0}} viewport={{once:true}} transition={{delay:0.3+i*0.12,duration:0.4}}
                style={{display:'grid',gridTemplateColumns:'16px 1fr',gap:12,alignItems:'flex-start',fontSize:13,lineHeight:1.55,color:'var(--fd-ink2)'}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:ORANGE,marginTop:7,display:'block'}}/>
                <span>{s}</span>
              </motion.li>
            ))}
          </ul>
        </>
      )}
      {tab==='strength'&&(
        workouts.length
          ? <StrengthInsightCard workouts={workouts} exercisePRs={exercisePRs} bodyweightLbs={bodyweightLbs}/>
          : <div style={{color:'var(--fd-ink3)',fontFamily:'var(--fd-mono)',fontSize:11,textAlign:'center',padding:24}}>
              Strength data loads after the scraper runs
            </div>
      )}
    </motion.div>
  )
}

function StrengthInsightCard({ workouts, exercisePRs, bodyweightLbs }){
  const now     = new Date()
  const cm      = now.getMonth(), cy = now.getFullYear()
  const monthWk = workouts.filter(w => { const d = new Date(w.started_at||w.workout_date); return d.getMonth()===cm&&d.getFullYear()===cy })
  const prevWk  = workouts.filter(w => { const d = new Date(w.started_at||w.workout_date); const prev = new Date(now); prev.setMonth(prev.getMonth()-1); return d.getMonth()===prev.getMonth()&&d.getFullYear()===prev.getFullYear() })
  const monthVol = monthWk.reduce((s,w) => s+(w.total_volume_lbs||0), 0)
  const prevVol  = prevWk.reduce((s,w)  => s+(w.total_volume_lbs||0), 0)
  const volChange = prevVol>0 ? Math.round(((monthVol-prevVol)/prevVol)*100) : null

  // Top PRs from the DB cache
  const topPRs = Object.values(exercisePRs)
    .filter(p => p.best_e1rm_lbs)
    .sort((a,b) => (b.best_e1rm_lbs||0)-(a.best_e1rm_lbs||0))
    .slice(0, 4)

  // Muscle balance: push vs pull vs legs from this month's workouts
  const pushMuscles = new Set(['chest','triceps','front_delts','upper_chest','shoulders'])
  const pullMuscles = new Set(['back','lats','biceps','rear_delts','rhomboids','traps'])
  const legMuscles  = new Set(['quadriceps','hamstrings','glutes','calves','quads'])
  let push=0, pull=0, legs=0
  for (const w of monthWk) {
    for (const m of (w.muscle_groups||[])) {
      if (pushMuscles.has(m)) push++
      else if (pullMuscles.has(m)) pull++
      else if (legMuscles.has(m)) legs++
    }
  }
  const balTotal = push+pull+legs||1
  const balance  = [
    { label:'Push', val:push,  pct:Math.round(push/balTotal*100),  color:'oklch(65% 0.16 25)' },
    { label:'Pull', val:pull,  pct:Math.round(pull/balTotal*100),  color:'oklch(65% 0.15 250)' },
    { label:'Legs', val:legs,  pct:Math.round(legs/balTotal*100),  color:'oklch(65% 0.16 280)' },
  ]

  // Strength milestones approaching (from computeLiftProfile)
  const profile = computeLiftProfile(workouts, bodyweightLbs||185)
  const upcoming = profile.filter(l => l.standard?.next && l.standard.next.val - l.e1rm <= 25)

  return(
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      {/* Volume this month */}
      <div>
        <div style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',letterSpacing:'.12em',textTransform:'uppercase',marginBottom:6}}>This month</div>
        <div style={{display:'flex',alignItems:'baseline',gap:8}}>
          <span style={{fontFamily:'var(--fd-serif)',fontSize:28,letterSpacing:'-0.02em',color:ORANGE}}>{(monthVol/1000).toFixed(0)}k</span>
          <span style={{fontFamily:'var(--fd-mono)',fontSize:11,color:'var(--fd-ink3)'}}>lbs lifted · {monthWk.length} sessions</span>
        </div>
        {volChange!==null&&(
          <div style={{fontFamily:'var(--fd-mono)',fontSize:10.5,color:volChange>=0?'var(--good)':'var(--bad)',marginTop:3}}>
            {volChange>=0?'↑':'↓'} {Math.abs(volChange)}% vs last month
          </div>
        )}
      </div>

      {/* Muscle balance bar */}
      {balTotal>1&&(
        <div>
          <div style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',letterSpacing:'.12em',textTransform:'uppercase',marginBottom:6}}>Muscle balance</div>
          <div style={{display:'flex',gap:2,height:10,borderRadius:5,overflow:'hidden',marginBottom:5}}>
            {balance.map(b=><div key={b.label} style={{flex:b.pct,background:b.color,transition:'flex .5s ease'}}/>)}
          </div>
          <div style={{display:'flex',gap:12,fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)'}}>
            {balance.map(b=><span key={b.label} style={{color:b.color}}>{b.label} {b.pct}%</span>)}
          </div>
        </div>
      )}

      {/* Top PRs */}
      {topPRs.length>0&&(
        <div>
          <div style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',letterSpacing:'.12em',textTransform:'uppercase',marginBottom:8}}>Top PRs (all time)</div>
          <div style={{display:'flex',flexDirection:'column',gap:5}}>
            {topPRs.map(p=>(
              <div key={p.exercise_name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontFamily:'var(--fd-mono)',fontSize:11}}>
                <span style={{color:'var(--fd-ink2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'55%'}}>{p.exercise_name}</span>
                <span style={{color:ORANGE,flexShrink:0}}>
                  <b>{p.best_weight_lbs}</b>
                  <span style={{color:'var(--fd-ink3)'}}> × {p.best_reps} lbs</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming milestones */}
      {upcoming.length>0&&(
        <div>
          <div style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',letterSpacing:'.12em',textTransform:'uppercase',marginBottom:8}}>🎯 Close milestones</div>
          <div style={{display:'flex',flexDirection:'column',gap:5}}>
            {upcoming.map(l=>(
              <div key={l.key} style={{fontFamily:'var(--fd-mono)',fontSize:11}}>
                <span style={{color:'var(--fd-ink3)'}}>{l.displayName}: </span>
                <span style={{color:ORANGE}}>+{l.standard.next.val - l.e1rm} lbs</span>
                <span style={{color:'rgba(255,255,255,0.4)'}}> → {l.standard.next.val} lbs ({LEVEL_LABELS[(l.standard.levelIdx||0)+1]})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Mini progress bar chart (shared by run + exercise cards) ─────────────────
function MiniProgressBars({ points, color, label, prIdx = -1, fmtVal = v => v }) {
  const vals = points.map(p => p.value)
  const mx   = Math.max(1, ...vals.filter(Boolean))
  if (!vals.length) return null
  return (
    <div>
      <div style={{ fontFamily:'var(--fd-mono)', fontSize:9.5, color:'var(--fd-ink3)', letterSpacing:'.1em', textTransform:'uppercase', marginBottom:8 }}>{label}</div>
      <div style={{ display:'flex', gap:4, alignItems:'flex-end', height:40 }}>
        {points.map((p, i) => {
          const h    = Math.max(4, ((p.value || 0) / mx) * 40)
          const isPR = i === prIdx
          return (
            <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
              <motion.div
                initial={{ height: 0 }} animate={{ height: h }}
                transition={{ duration: 0.5, delay: i * 0.04, ease: [0.2, 0.7, 0.2, 1] }}
                style={{ width:'100%', borderRadius:3, background: isPR ? ORANGE : color, opacity: isPR ? 1 : 0.55 + (i / points.length) * 0.45 }}
                title={`${p.label}: ${fmtVal(p.value)}`}/>
              <span style={{ fontFamily:'var(--fd-mono)', fontSize:8, color: isPR ? ORANGE : 'var(--fd-ink3)', whiteSpace:'nowrap', overflow:'hidden', maxWidth:30, textOverflow:'ellipsis' }}>
                {p.shortLabel || p.label?.slice(-3)}
              </span>
            </div>
          )
        })}
      </div>
      {prIdx >= 0 && <div style={{ fontFamily:'var(--fd-mono)', fontSize:9, color:ORANGE, marginTop:4 }}>🏆 PR = {fmtVal(points[prIdx]?.value)}</div>}
    </div>
  )
}

// ── Run history helpers ───────────────────────────────────────────────────────
function buildRunHistory(acts, thisAct) {
  const runs = acts.filter(a => ['run','Run'].includes(a.type) && a.distance_m > 0 && a.duration_secs > 0)
    .sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
  const paceOf = a => a.duration_secs / (a.distance_m / 1000)  // min/km as decimal seconds
  const last8  = runs.slice(-8)
  const allPaces = last8.map(paceOf)
  const prPaceRun = runs.reduce((b, a) => !b || paceOf(a) < paceOf(b) ? a : b, null)
  const prIdx  = last8.findIndex(a => a.id === prPaceRun?.id)
  const fmtPace = secs => { const m = Math.floor(secs/60), s = Math.round(secs%60); return `${m}:${String(s).padStart(2,'0')}/km` }
  const points = last8.map(a => ({
    label: new Date(a.started_at).toLocaleDateString('en',{month:'short',day:'numeric'}),
    shortLabel: new Date(a.started_at).toLocaleDateString('en',{day:'numeric',month:'short'}),
    value: paceOf(a),
  }))
  // For pace, lower = better, so invert for bar height
  const minP = Math.min(...allPaces), maxP = Math.max(...allPaces)
  const inverted = points.map(p => ({ ...p, value: maxP + minP - p.value }))
  const prDistRun = runs.reduce((b, a) => !b || a.distance_m > b.distance_m ? a : b, null)
  return { points: inverted, prIdx, fmtPace, prPaceRun, prDistRun, last8 }
}

// ── Activity feed ─────────────────────────────────────────────────────────────
function FeedRow({act, idx, openId, setOpenId, allActs, gymWorkout}){
  const open   = openId === act.id
  const color  = TC[act.type] || ORANGE
  const isRun      = ['run','Run'].includes(act.type)
  const isStrength = act.type === 'strength'
  const displayCals = act.calories || estimateCals(act)
  const calsIsEstimate = !act.calories && displayCals > 0

  const fmtDate = s => {
    const diff = (Date.now() - new Date(s).getTime()) / 86400000
    const d = new Date(s)
    if (diff < 1)  return 'Today, '   + d.toLocaleTimeString('en', {hour:'numeric', minute:'2-digit'})
    if (diff < 2)  return 'Yesterday, '+ d.toLocaleTimeString('en', {hour:'numeric', minute:'2-digit'})
    if (diff < 7)  return d.toLocaleDateString('en', {weekday:'long'})
    return d.toLocaleDateString('en', {month:'short', day:'numeric'})
  }
  const fmtPace = a => {
    if (!a.distance_m || !a.duration_secs) return '—'
    const p = a.duration_secs / (a.distance_m / 1000)
    return `${Math.floor(p/60)}:${String(Math.round(p%60)).padStart(2,'0')}/km`
  }

  const runHistory = useMemo(() => {
    if (!open || !isRun || !allActs) return null
    return buildRunHistory(allActs, act)
  }, [open, isRun, allActs])

  const prDistRun = runHistory?.prDistRun
  const prPaceRun = runHistory?.prPaceRun
  const isPRPace  = prPaceRun?.id === act.id
  const isPRDist  = prDistRun?.id === act.id

  // Strength: all named exercises (include bodyweight/reps-only), weighted first
  const exercises = useMemo(() =>
    (gymWorkout?.exercises || [])
      .filter(e => e.name && !e.name.toLowerCase().startsWith('unknown'))
      .sort((a,b) => {
        if (!!a.top_set_weight_lbs !== !!b.top_set_weight_lbs) return a.top_set_weight_lbs ? -1 : 1
        return (b.top_set_weight_lbs||0) - (a.top_set_weight_lbs||0)
      })
  , [gymWorkout])

  const hasGymData = isStrength && gymWorkout

  return (
    <motion.div layout
      initial={{opacity:0, x:-16}} animate={{opacity:1, x:0}}
      transition={{duration:0.4, delay:idx*0.04}}
      onClick={() => setOpenId(open ? null : act.id)}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${(isPRPace||isPRDist) ? ORANGE+'44' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 12, padding:'14px 16px 14px 18px',
        position:'relative', cursor:'pointer', overflow:'hidden',
      }}>
      <span style={{position:'absolute',left:0,top:10,bottom:10,width:3,borderRadius:2,background:color}}/>

      {/* ── Collapsed row ── */}
      <div style={{display:'grid', gridTemplateColumns:'1fr auto auto auto auto', gap:12, alignItems:'center'}}>
        <div>
          <div style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
            <span style={{fontFamily:'var(--fd-mono)',fontSize:10,color,letterSpacing:'.16em',textTransform:'uppercase'}}>{act.type}</span>
            {isPRPace && <span style={{fontFamily:'var(--fd-mono)',fontSize:9,background:ORANGE,color:'#0e0c0a',borderRadius:4,padding:'1px 5px',letterSpacing:'.06em'}}>⚡ PACE PR</span>}
            {isPRDist && <span style={{fontFamily:'var(--fd-mono)',fontSize:9,background:'var(--good)',color:'#0e0c0a',borderRadius:4,padding:'1px 5px',letterSpacing:'.06em'}}>📏 DIST PR</span>}
            {hasGymData && !open && (
              <span style={{fontFamily:'var(--fd-mono)',fontSize:9,color:'var(--fd-ink3)',background:'rgba(255,255,255,0.06)',borderRadius:4,padding:'1px 5px',letterSpacing:'.06em'}}>
                {exercises.length} exercises
              </span>
            )}
            {isRun && !open && allActs.filter(a=>['run','Run'].includes(a.type)).length > 1 && (
              <span style={{fontFamily:'var(--fd-mono)',fontSize:9,color:'var(--fd-ink3)',background:'rgba(255,255,255,0.06)',borderRadius:4,padding:'1px 5px',letterSpacing:'.06em'}}>↗ trend</span>
            )}
          </div>
          <div style={{fontSize:14, color:'var(--fd-ink1)', marginTop:3}}>{act.name || '—'}</div>
          <div style={{fontFamily:'var(--fd-mono)',fontSize:10.5,color:'var(--fd-ink3)',marginTop:4}}>
            {fmtDate(act.started_at)}
            {isStrength && gymWorkout?.total_volume_lbs
              ? <span style={{marginLeft:8}}>· <b style={{color:'var(--fd-ink2)'}}>{gymWorkout.total_volume_lbs.toLocaleString()}</b> lbs total vol.</span>
              : null}
            {!isStrength && act.source ? <span> · {act.source}</span> : null}
          </div>
        </div>

        {/* Stats columns — distance/volume | duration | cals */}
        {isStrength ? (
          <>
            <div style={{fontFamily:'var(--fd-mono)',fontSize:13,color:'var(--fd-ink1)',textAlign:'right',minWidth:58}}>
              <b style={{color:TC.strength}}>
                {exercises[0]?.top_set_weight_lbs ?? (exercises[0]?.top_set_reps ? `${exercises[0].top_set_reps}r` : '—')}
              </b>
              <small style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',display:'block',marginTop:2}}>
                {exercises[0]?.top_set_weight_lbs ? 'top lbs' : exercises[0]?.top_set_reps ? 'best reps' : 'no data'}
              </small>
            </div>
            <div style={{fontFamily:'var(--fd-mono)',fontSize:13,color:'var(--fd-ink1)',textAlign:'right',minWidth:44}}>
              <b>{act.duration_secs ? Math.round(act.duration_secs/60) : '—'}</b>
              <small style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',display:'block',marginTop:2}}>min</small>
            </div>
            <div style={{fontFamily:'var(--fd-mono)',fontSize:13,color:'var(--fd-ink3)',textAlign:'right',minWidth:52}}>
              <b>{exercises.length || '—'}</b>
              <small style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',display:'block',marginTop:2}}>lifts</small>
            </div>
          </>
        ) : (
          <>
            <div style={{fontFamily:'var(--fd-mono)',fontSize:13,color:'var(--fd-ink1)',textAlign:'right',minWidth:58}}>
              <b>{act.distance_m ? (act.distance_m/1000).toFixed(2) : '—'}</b>
              <small style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',display:'block',marginTop:2}}>{act.distance_m ? 'km' : 'no dist.'}</small>
            </div>
            <div style={{fontFamily:'var(--fd-mono)',fontSize:13,color:'var(--fd-ink1)',textAlign:'right',minWidth:44}}>
              <b>{act.duration_secs ? Math.round(act.duration_secs/60) : '—'}</b>
              <small style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',display:'block',marginTop:2}}>min</small>
            </div>
            <div style={{fontFamily:'var(--fd-mono)',fontSize:13,color:calsIsEstimate?'var(--fd-ink3)':'var(--fd-ink1)',textAlign:'right',minWidth:52}}>
              <b>{displayCals || '—'}</b>
              <small style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',display:'block',marginTop:2}}>{calsIsEstimate ? '~kcal' : 'kcal'}</small>
            </div>
          </>
        )}

        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
          style={{color:'var(--fd-ink3)', transition:'transform .25s', transform:open?'rotate(180deg)':'none'}}>
          <path d="M3 5 L7 9 L11 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* ── Expanded body ── */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body"
            initial={{height:0, opacity:0}} animate={{height:'auto', opacity:1}} exit={{height:0, opacity:0}}
            transition={{duration:0.28, ease:[0.2,0.7,0.2,1]}}
            style={{overflow:'hidden'}}>
            <div style={{borderTop:'1px dashed rgba(255,255,255,0.06)', marginTop:14, paddingTop:14}}>

              {/* ── Strength: exercise breakdown ── */}
              {isStrength && (
                hasGymData ? (
                  <div>
                    {/* Volume header */}
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:12}}>
                      <span style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase'}}>Exercises · top set</span>
                      {gymWorkout.total_volume_lbs && (
                        <span style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)'}}>
                          Total volume: <b style={{color:TC.strength}}>{gymWorkout.total_volume_lbs.toLocaleString()} lbs</b>
                        </span>
                      )}
                    </div>
                    {/* Muscle group tags */}
                    {gymWorkout.muscle_groups?.length > 0 && (
                      <div style={{display:'flex', gap:4, flexWrap:'wrap', marginBottom:12}}>
                        {gymWorkout.muscle_groups.map(mg => (
                          <span key={mg} style={{
                            fontFamily:'var(--fd-mono)', fontSize:9, letterSpacing:'.1em',
                            textTransform:'uppercase', padding:'2px 7px', borderRadius:4,
                            background: MUSCLE_COLORS[mg.toLowerCase().replace(/\s/g,'_')] ? `${MUSCLE_COLORS[mg.toLowerCase().replace(/\s/g,'_')]}22` : 'rgba(255,255,255,0.06)',
                            color: MUSCLE_COLORS[mg.toLowerCase().replace(/\s/g,'_')] || 'var(--fd-ink3)',
                            border: `1px solid ${MUSCLE_COLORS[mg.toLowerCase().replace(/\s/g,'_')] || 'rgba(255,255,255,0.1)'}44`,
                          }}>{mg}</span>
                        ))}
                      </div>
                    )}
                    {/* Exercise list */}
                    <div style={{display:'flex', flexDirection:'column', gap:6}}>
                      {exercises.map((ex, i) => (
                        <div key={i} style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                          <span style={{fontFamily:'var(--fd-mono)', fontSize:11, color:'var(--fd-ink2)', flex:1, minWidth:0,
                            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                            {ex.name}
                          </span>
                          <span style={{fontFamily:'var(--fd-mono)', fontSize:11, color:ex.top_set_weight_lbs ? TC.strength : 'var(--fd-ink3)', flexShrink:0, fontWeight:600}}>
                            {ex.top_set_weight_lbs
                              ? <>{ex.top_set_weight_lbs} lbs{ex.top_set_reps ? <span style={{color:'var(--fd-ink3)', fontWeight:400}}> × {ex.top_set_reps}</span> : null}</>
                              : ex.top_set_reps
                                ? <span style={{fontWeight:400}}>bodyweight × {ex.top_set_reps}</span>
                                : <span style={{color:'rgba(255,255,255,0.2)', fontWeight:400}}>tracked</span>
                            }
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Avg HR if available */}
                    {act.avg_hr && (
                      <div style={{marginTop:10, fontFamily:'var(--fd-mono)', fontSize:10, color:'var(--fd-ink3)'}}>
                        Avg HR: <b style={{color:'var(--fd-ink2)'}}>{act.avg_hr} bpm</b>
                        {act.duration_secs && <span style={{marginLeft:10}}>· Duration: <b style={{color:'var(--fd-ink2)'}}>{Math.round(act.duration_secs/60)} min</b></span>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{fontFamily:'var(--fd-mono)',fontSize:11,color:'var(--fd-ink3)',padding:'8px 0'}}>
                    No exercise data — add photos to this Strava activity and re-run the scraper to capture lifts.
                  </div>
                )
              )}

              {/* ── Cardio: stats + run chart ── */}
              {!isStrength && (
                <>
                  <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16, marginBottom: isRun&&runHistory ? 18 : 0}}>
                    {[
                      ['Pace',      act.avg_speed_kmh ? `${act.avg_speed_kmh} km/h` : fmtPace(act)],
                      ['Avg HR',    act.avg_hr ? `${act.avg_hr} bpm` : '—'],
                      ['Calories',  displayCals ? `${displayCals}${calsIsEstimate?' est.':''} kcal` : '—'],
                      ['Elevation', act.elevation_gain_m ? `+${act.elevation_gain_m} m` : '—'],
                    ].map(([l,v]) => (
                      <div key={l} style={{display:'flex', flexDirection:'column', gap:4}}>
                        <span style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase'}}>{l}</span>
                        <span style={{fontFamily:'var(--fd-mono)',fontSize:14,color:'var(--fd-ink1)'}}>{v}</span>
                      </div>
                    ))}
                  </div>
                  {isRun && runHistory && runHistory.points.length > 1 && (
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,borderTop:'1px solid rgba(255,255,255,0.05)',paddingTop:14}}>
                      <div>
                        <div style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',letterSpacing:'.1em',textTransform:'uppercase',marginBottom:8}}>Personal records</div>
                        <div style={{display:'flex',flexDirection:'column',gap:6}}>
                          {prPaceRun && (
                            <div style={{fontFamily:'var(--fd-mono)',fontSize:11}}>
                              <span style={{color:'var(--fd-ink3)'}}>⚡ Best pace · </span>
                              <b style={{color:ORANGE}}>{runHistory.fmtPace(runHistory.last8[runHistory.prIdx]?.duration_secs/(runHistory.last8[runHistory.prIdx]?.distance_m/1000)||0)}</b>
                              <span style={{color:'var(--fd-ink3)',fontSize:10}}> ({new Date(prPaceRun.started_at).toLocaleDateString('en',{month:'short',day:'numeric'})})</span>
                            </div>
                          )}
                          {prDistRun && (
                            <div style={{fontFamily:'var(--fd-mono)',fontSize:11}}>
                              <span style={{color:'var(--fd-ink3)'}}>📏 Longest · </span>
                              <b style={{color:'var(--good)'}}>{(prDistRun.distance_m/1000).toFixed(1)} km</b>
                              <span style={{color:'var(--fd-ink3)',fontSize:10}}> ({new Date(prDistRun.started_at).toLocaleDateString('en',{month:'short',day:'numeric'})})</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <MiniProgressBars points={runHistory.points} color={color} label="Pace trend (lower=faster)" prIdx={runHistory.prIdx}
                        fmtVal={v=>{ const real=runHistory.points.reduce((mx,p)=>Math.max(mx,p.value),0)+Math.min(...runHistory.points.map(p=>p.value))-v; const m=Math.floor(real/60),s=Math.round(real%60); return`${m}:${String(s).padStart(2,'0')}/km` }}/>
                    </div>
                  )}
                </>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function Feed({acts, gymByExtId = {}}) {
  const [openId, setOpenId] = useState(null)
  return (
    <div style={{display:'flex', flexDirection:'column', gap:8}}>
      {acts.map((a,i) => (
        <FeedRow key={a.id} act={a} idx={i}
          openId={openId} setOpenId={setOpenId}
          allActs={acts}
          gymWorkout={gymByExtId[a.external_id] ?? null}/>
      ))}
    </div>
  )
}

// ── Duration pill selector ────────────────────────────────────────────────────
const DURATIONS=[{k:'7d',l:'1W'},{k:'1m',l:'1M'},{k:'6m',l:'6M'},{k:'1y',l:'1Y'}]
function DurationPill({value,onChange}){
  return(
    <div style={{display:'inline-flex',gap:3,background:'rgba(255,255,255,0.04)',borderRadius:8,padding:3}}>
      {DURATIONS.map(d=>(
        <button key={d.k} onClick={()=>onChange(d.k)}
          style={{fontFamily:'var(--fd-mono)',fontSize:10,letterSpacing:'.1em',padding:'4px 10px',borderRadius:6,border:'none',cursor:'pointer',transition:'all .18s',
            background:value===d.k?'rgba(255,255,255,0.12)':'transparent',
            color:value===d.k?'var(--fd-ink1)':'var(--fd-ink3)'}}>
          {d.l}
        </button>
      ))}
    </div>
  )
}
function sliceByDuration(arr,dur){
  const n=dur==='7d'?7:dur==='1m'?30:dur==='6m'?180:365
  return arr.slice(-n)
}

// ── Health trends from Apple Health ──────────────────────────────────────────
function MiniSparkline({data,color,label,unit,dec=0,good='up'}){
  const ref=useRef(null);const[w,setW]=useState(220);const[expanded,setExpanded]=useState(false)
  useEffect(()=>{if(!ref.current)return;const ro=new ResizeObserver(([e])=>setW(e.contentRect.width));ro.observe(ref.current);return()=>ro.disconnect()},[])
  const vals=data.filter(v=>v!=null&&v>0)
  if(!vals.length) return(
    <div ref={ref} style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:14,padding:'14px 16px',display:'flex',flexDirection:'column',gap:6}}>
      <div style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase'}}>{label}</div>
      <div style={{fontFamily:'var(--fd-serif)',fontSize:28,color:'var(--fd-ink3)'}}>—</div>
    </div>
  )
  const last=vals[vals.length-1],prev=vals.slice(-8,-1)
  const prevAvg=prev.length?prev.reduce((s,v)=>s+v,0)/prev.length:last
  const delta=last-prevAvg,up=delta>=0,isGood=good==='up'?up:!up
  const mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1
  const mkPath=(pts,h)=>pts.map((v,i)=>`${i===0?'M':'L'} ${((i/(pts.length-1||1))*100).toFixed(1)} ${(h-((v-mn)/rng)*(h-6)-3).toFixed(1)}`).join(' ')
  const path=mkPath(vals.slice(-28),44)
  const pathLg=mkPath(vals,80)
  return(
    <>
      <div ref={ref} onClick={()=>setExpanded(true)} style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:14,padding:'14px 16px',display:'flex',flexDirection:'column',gap:0,position:'relative',overflow:'hidden',cursor:'pointer',transition:'border-color .18s'}}
        onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.16)'}
        onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.06)'}>
        <div style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase',marginBottom:6}}>{label}</div>
        <div style={{display:'flex',alignItems:'baseline',gap:6}}>
          <span style={{fontFamily:'var(--fd-serif)',fontSize:28,letterSpacing:'-0.02em',color:'var(--fd-ink1)'}}>{dec>0?last.toFixed(dec):Math.round(last).toLocaleString()}</span>
          <span style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)'}}>{unit}</span>
          {Math.abs(delta)>0.05&&<span style={{fontFamily:'var(--fd-mono)',fontSize:10,color:isGood?'var(--good)':'var(--bad)',marginLeft:4}}>{up?'↑':'↓'}{dec>0?Math.abs(delta).toFixed(dec):Math.round(Math.abs(delta))}</span>}
        </div>
        <svg style={{position:'absolute',right:0,bottom:0,width:'55%',height:44,pointerEvents:'none',opacity:0.6}} viewBox="0 0 100 44" preserveAspectRatio="none">
          <motion.path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" initial={{pathLength:0}} animate={{pathLength:1}} transition={{duration:1.4,ease:[0.2,0.7,0.2,1]}}/>
        </svg>
        {/* expand hint */}
        <div style={{position:'absolute',top:10,right:10,fontFamily:'var(--fd-mono)',fontSize:9,color:'var(--fd-ink3)',opacity:0.5}}>⤢</div>
      </div>
      {/* Expanded modal */}
      <AnimatePresence>
        {expanded&&(
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            style={{position:'fixed',inset:0,zIndex:9000,background:'rgba(0,0,0,0.82)',backdropFilter:'blur(10px)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}}
            onClick={()=>setExpanded(false)}>
            <motion.div initial={{scale:0.9,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.9,opacity:0}} transition={{type:'spring',stiffness:240,damping:24}}
              style={{background:'#1a1714',border:'1px solid rgba(255,255,255,0.1)',borderRadius:20,padding:28,width:'min(760px,95vw)'}}
              onClick={e=>e.stopPropagation()}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
                <div>
                  <div style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase'}}>{label}</div>
                  <div style={{display:'flex',alignItems:'baseline',gap:8,marginTop:4}}>
                    <span style={{fontFamily:'var(--fd-serif)',fontSize:36,color:'var(--fd-ink1)'}}>{dec>0?last.toFixed(dec):Math.round(last).toLocaleString()}</span>
                    <span style={{fontFamily:'var(--fd-mono)',fontSize:12,color:'var(--fd-ink3)'}}>{unit}</span>
                    {Math.abs(delta)>0.05&&<span style={{fontFamily:'var(--fd-mono)',fontSize:12,color:isGood?'var(--good)':'var(--bad)'}}>{up?'↑':'↓'}{dec>0?Math.abs(delta).toFixed(dec):Math.round(Math.abs(delta))} vs 7d avg</span>}
                  </div>
                </div>
                <button onClick={()=>setExpanded(false)} style={{background:'rgba(255,255,255,0.06)',border:'none',borderRadius:8,padding:'8px 14px',color:'var(--fd-ink3)',fontFamily:'var(--fd-mono)',fontSize:11,cursor:'pointer'}}>✕ close</button>
              </div>
              <div style={{display:'flex',gap:16,marginBottom:16,fontFamily:'var(--fd-mono)',fontSize:10.5,color:'var(--fd-ink3)'}}>
                <span>Min: <b style={{color:'var(--fd-ink1)'}}>{dec>0?mn.toFixed(dec):Math.round(mn).toLocaleString()}</b></span>
                <span>Max: <b style={{color:'var(--fd-ink1)'}}>{dec>0?mx.toFixed(dec):Math.round(mx).toLocaleString()}</b></span>
                <span>Avg: <b style={{color:'var(--fd-ink1)'}}>{dec>0?(vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(dec):Math.round(vals.reduce((s,v)=>s+v,0)/vals.length).toLocaleString()}</b></span>
                <span>Datapoints: <b style={{color:'var(--fd-ink1)'}}>{vals.length}</b></span>
              </div>
              <svg style={{width:'100%',height:120,display:'block'}} viewBox="0 0 100 80" preserveAspectRatio="none">
                <motion.path d={pathLg} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" initial={{pathLength:0}} animate={{pathLength:1}} transition={{duration:1.2}}/>
              </svg>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function SleepStages({daily}){
  const last14=daily.slice(-14).filter(d=>d.sleep_hrs>0)
  if(!last14.length) return null
  const avgDeep=last14.reduce((s,d)=>s+(d.sleep_deep_hrs||0),0)/last14.length
  const avgRem =last14.reduce((s,d)=>s+(d.sleep_rem_hrs||0),0)/last14.length
  const avgTotal=last14.reduce((s,d)=>s+(d.sleep_hrs||0),0)/last14.length
  const avgOther=Math.max(0,avgTotal-avgDeep-avgRem)
  const pct=v=>avgTotal>0?Math.round(v/avgTotal*100):0
  const bars=[
    {label:'Deep',val:avgDeep,color:'oklch(65% 0.14 235)',tip:'Memory consolidation & physical repair'},
    {label:'REM',val:avgRem,color:'oklch(72% 0.18 300)',tip:'Emotional processing & creativity'},
    {label:'Light/Awake',val:avgOther,color:'rgba(255,255,255,0.15)',tip:'Transitions between stages'},
  ]
  return(
    <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:14,padding:'14px 16px'}}>
      <div style={{fontFamily:'var(--fd-mono)',fontSize:9.5,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase',marginBottom:10}}>Sleep Stages · 14d avg</div>
      <div style={{display:'flex',height:10,borderRadius:6,overflow:'hidden',gap:2,marginBottom:12}}>
        {bars.map(b=>(b.val>0&&
          <motion.div key={b.label} style={{background:b.color,borderRadius:4,flex:b.val}}
            initial={{scaleX:0}} animate={{scaleX:1}} transition={{duration:0.8,ease:[0.2,0.7,0.2,1]}}/>
        ))}
      </div>
      {bars.map(b=>(
        <div key={b.label} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
          <span style={{width:8,height:8,borderRadius:2,background:b.color,display:'inline-block',flexShrink:0}}/>
          <span style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',flex:1}}>{b.label}</span>
          <span style={{fontFamily:'var(--fd-mono)',fontSize:11,color:'var(--fd-ink1)'}}>{b.val.toFixed(1)}h</span>
          <span style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',width:30,textAlign:'right'}}>{pct(b.val)}%</span>
        </div>
      ))}
    </div>
  )
}

function HealthTrends({daily}){
  const[dur,setDur]=useState('1m')
  const d=useMemo(()=>sliceByDuration(daily,dur),[daily,dur])
  return(
    <div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:14}}>
        <DurationPill value={dur} onChange={setDur}/>
      </div>
      <div style={{display:'grid',gap:12,gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))'}}>
        <MiniSparkline data={d.map(x=>x.steps)}         color="oklch(72% 0.18 140)" label="Daily Steps"  unit="steps"  good="up"/>
        <MiniSparkline data={d.map(x=>x.active_cals)}   color={ORANGE}               label="Active Cals"  unit="kcal"   good="up"/>
        <MiniSparkline data={d.map(x=>x.vo2_max)}       color="oklch(72% 0.18 250)" label="VO₂ Max"      unit="ml/kg"  dec={1} good="up"/>
        <MiniSparkline data={d.map(x=>x.exercise_mins)} color="oklch(72% 0.16 200)" label="Exercise"     unit="min"    good="up"/>
        <MiniSparkline data={d.map(x=>x.stand_hours)}   color="oklch(70% 0.12 160)" label="Stand Hours"  unit="hrs"    good="up"/>
        <MiniSparkline data={d.map(x=>x.sleep_deep_hrs)}color="oklch(65% 0.14 235)" label="Deep Sleep"   unit="hrs"    dec={1} good="up"/>
        <SleepStages daily={d}/>
      </div>
    </div>
  )
}

// ── Strength analytics helpers ────────────────────────────────────────────────
function getCanonicalLift(name) {
  const n = (name||'').toLowerCase()
  for (const { key, terms } of CANONICAL_LIFT_MAP) {
    if (terms.some(t => n.includes(t))) return key
  }
  return null
}

function getLiftPercentile(e1rm, bwLbs, liftKey) {
  const ratios = LIFT_RATIOS[liftKey]
  if (!ratios || !e1rm) return null
  const BW = bwLbs || 185
  const thresholds = ratios.map((r, i) => ({ level: LEVEL_LABELS[i], pct: LEVEL_PCTS[i], color: LEVEL_COLORS[i], val: Math.round(BW * r) }))
  if (e1rm < thresholds[0].val) return { level: 'Sub-Untrained', pct: 2, color: 'rgba(255,255,255,0.2)', levelIdx: -1 }
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (e1rm >= thresholds[i].val) {
      const next = thresholds[i + 1]
      let pct = thresholds[i].pct
      if (next && e1rm < next.val) {
        const t = (e1rm - thresholds[i].val) / (next.val - thresholds[i].val)
        pct = Math.round(thresholds[i].pct + t * (next.pct - thresholds[i].pct))
      } else if (!next) {
        pct = Math.min(99, 93 + Math.round((e1rm - thresholds[i].val) / thresholds[i].val * 20))
      }
      return { level: thresholds[i].level, pct, color: thresholds[i].color, levelIdx: i, thresholds, next }
    }
  }
  return null
}

function computeLiftProfile(workouts, bwLbs) {
  const bests = {}  // key → { e1rm, name, date, workoutName }
  for (const w of workouts) {
    for (const ex of (w.exercises || [])) {
      const key = getCanonicalLift(ex.name)
      if (!key) continue
      const e1rm = ex.e1rm_lbs
      if (!e1rm) continue
      if (!bests[key] || e1rm > bests[key].e1rm) {
        bests[key] = { e1rm, name: ex.name, date: w.workout_date || w.started_at?.slice(0,10), workoutName: w.workout_name }
      }
    }
  }
  const LIFT_DISPLAY = { bench:'Bench Press', squat:'Squat', deadlift:'Deadlift', ohp:'Overhead Press', row:'Barbell Row' }
  const LIFT_ICON    = { bench:'🏋', squat:'⬇', deadlift:'🔺', ohp:'🔼', row:'↔' }
  return Object.entries(bests).map(([key, v]) => ({
    key, ...v,
    displayName: LIFT_DISPLAY[key] || key,
    icon: LIFT_ICON[key] || '●',
    standard: getLiftPercentile(v.e1rm, bwLbs, key),
  })).sort((a, b) => LEVEL_PCTS.indexOf(b.standard?.pct) - LEVEL_PCTS.indexOf(a.standard?.pct))
}

function buildWeeklyStrengthData(workouts, nWeeks = 8) {
  const today = new Date(); today.setHours(0,0,0,0)
  const dow = today.getDay() === 0 ? 7 : today.getDay()
  const mon = new Date(today); mon.setDate(mon.getDate() - (dow - 1))
  return Array.from({ length: nWeeks }, (_, w) => {
    const start = new Date(mon); start.setDate(start.getDate() - (nWeeks - 1 - w) * 7)
    const end   = new Date(start); end.setDate(end.getDate() + 7)
    const wkw   = workouts.filter(w => { const t = new Date(w.started_at||w.workout_date).getTime(); return t >= start && t < end })
    return {
      label:    start.toLocaleString('en', { month: 'short', day: 'numeric' }),
      vol_lbs:  Math.round(wkw.reduce((s, w) => s + (w.total_volume_lbs || 0), 0)),
      sessions: wkw.length,
      isCurrent: w === nWeeks - 1,
    }
  })
}

function getMuscleFrequency(workouts) {
  const freq = {}, vol = {}
  for (const w of workouts) {
    const muscles = Array.isArray(w.muscle_groups) ? w.muscle_groups
      : (w.exercises||[]).flatMap(ex => [
          ...(ex.muscle_groups?.primary||[]),
          ...(ex.muscle_groups?.secondary||[]),
        ])
    const seen = new Set()
    for (const m of muscles) {
      const k = m.replace(/[ _-]/g,'_').toLowerCase()
      if (!seen.has(k)) { freq[k] = (freq[k]||0)+1; seen.add(k) }
      vol[k]  = (vol[k]||0)+(w.total_volume_lbs||0)/muscles.length
    }
  }
  return Object.entries(freq)
    .map(([m, f]) => ({ muscle: m, freq: f, vol: Math.round(vol[m]||0) }))
    .sort((a,b) => b.freq - a.freq)
    .slice(0, 10)
}

// ── Strength volume timeline (weekly bars for strength) ───────────────────────
function StrengthVolumeChart({ workouts }) {
  const ref = useRef(null); const [w, setW] = useState(520)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)))
    ro.observe(ref.current); return () => ro.disconnect()
  }, [])
  const [hover, setHover] = useState(null)
  const data = useMemo(() => buildWeeklyStrengthData(workouts, 8), [workouts])
  if (!data.some(d => d.vol_lbs > 0))
    return <div style={{height:180,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--fd-ink3)',fontFamily:'var(--fd-mono)',fontSize:11}}>No volume data yet</div>

  const h = 200, pL = 44, pR = 12, pT = 16, pB = 28
  const iW = w - pL - pR, iH = h - pT - pB
  const mx = Math.max(1000, ...data.map(d => d.vol_lbs))
  const yMax = Math.ceil(mx / 10000) * 10000
  const bw2 = iW / data.length

  return (
    <div ref={ref} style={{ position: 'relative', minHeight: h }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const y = pT + iH - t * iH; const v = Math.round(t * yMax / 1000)
          return <g key={i}>
            <line x1={pL} x2={w-pR} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray={i===0?'':'2 4'}/>
            <text x={pL-7} y={y+3} textAnchor="end" fontFamily="var(--fd-mono)" fontSize="9" fill="var(--fd-ink3)">{v}k</text>
          </g>
        })}
        {data.map((d, i) => {
          const bh = (d.vol_lbs / yMax) * iH
          const x  = pL + i * bw2 + bw2 * 0.18
          const bw3 = bw2 * 0.64
          const y  = pT + iH - bh
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
              <rect x={pL + i*bw2} y={pT} width={bw2} height={iH} fill="transparent"/>
              <motion.rect x={x} y={y} width={bw3} height={Math.max(bh, 2)} rx="3"
                fill={d.isCurrent ? ORANGE : hover === i ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.14)'}
                initial={{ scaleY: 0, transformOrigin: `${x + bw3/2}px ${pT+iH}px` }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: [0.2, 0.7, 0.2, 1] }}
              />
              {d.isCurrent && d.vol_lbs > 0 && (
                <motion.text x={x + bw3/2} y={y - 7} textAnchor="middle" fontFamily="var(--fd-mono)" fontSize="9.5" fill={ORANGE}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
                  {(d.vol_lbs/1000).toFixed(0)}k
                </motion.text>
              )}
              <text x={x + bw3/2} y={h - 9} textAnchor="middle" fontFamily="var(--fd-mono)" fontSize="9" fill="var(--fd-ink3)">{d.label}</text>
            </g>
          )
        })}
      </svg>
      {hover != null && data[hover] && (
        <div style={{ position:'absolute', background:'#0e0c0a', border:'1px solid rgba(255,255,255,0.1)', color:'var(--fd-ink1)', padding:'9px 13px', borderRadius:8, fontFamily:'var(--fd-mono)', fontSize:10.5, pointerEvents:'none', zIndex:10, whiteSpace:'nowrap',
          left: `${((pL + hover*bw2 + bw2/2)/w)*100}%`, top: 0, transform:'translate(-50%,-100%) translateY(-8px)' }}>
          <div style={{ color:'var(--fd-ink3)', fontSize:10, marginBottom:4 }}>Week of {data[hover].label}</div>
          <b style={{ fontSize:13 }}>{data[hover].vol_lbs.toLocaleString()}</b> lbs
          <span style={{ color:'var(--fd-ink3)', marginLeft:8 }}>{data[hover].sessions} session{data[hover].sessions!==1?'s':''}</span>
        </div>
      )}
    </div>
  )
}

// ── Muscle frequency horizontal bars ─────────────────────────────────────────
function MuscleFrequencyChart({ workouts }) {
  const data = useMemo(() => getMuscleFrequency(workouts), [workouts])
  const max  = data[0]?.freq || 1
  if (!data.length)
    return <div style={{color:'var(--fd-ink3)',fontFamily:'var(--fd-mono)',fontSize:11,textAlign:'center',padding:24}}>No muscle data yet</div>

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {data.map(({ muscle, freq }) => {
        const label  = muscle.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        const color  = MUSCLE_COLORS[muscle] || 'oklch(65% 0.14 280)'
        const pct    = (freq / max) * 100
        return (
          <div key={muscle} style={{ display:'grid', gridTemplateColumns:'110px 1fr 28px', gap:8, alignItems:'center' }}>
            <span style={{ fontFamily:'var(--fd-mono)', fontSize:10, color:'var(--fd-ink2)', letterSpacing:'.04em', textOverflow:'ellipsis', overflow:'hidden', whiteSpace:'nowrap' }}>{label}</span>
            <div style={{ height:7, borderRadius:4, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}>
              <motion.div style={{ height:'100%', borderRadius:4, background:color }}
                initial={{ width:0 }} animate={{ width:`${pct}%` }}
                transition={{ duration:0.7, ease:[0.2,0.7,0.2,1] }}/>
            </div>
            <span style={{ fontFamily:'var(--fd-mono)', fontSize:10, color:color, textAlign:'right' }}>{freq}×</span>
          </div>
        )
      })}
    </div>
  )
}

// ── GymVerse lift log ─────────────────────────────────────────────────────────
function LiftLog({ workouts, exercisePRs = {} }) {
  const [openId, setOpenId]   = useState(null)
  const [openEx,  setOpenEx]  = useState(null)  // "workoutId::exerciseName"

  // Build exercise appearance history from local workout data (no extra fetch)
  const exerciseHistory = useMemo(() => {
    const h = {}
    for (const w of [...workouts].sort((a,b) => (a.workout_date||a.started_at) < (b.workout_date||b.started_at) ? -1 : 1)) {
      for (const ex of (w.exercises||[])) {
        if (!ex.name) continue
        if (!h[ex.name]) h[ex.name] = []
        h[ex.name].push({ date: w.workout_date||w.started_at?.slice(0,10), e1rm_lbs: ex.e1rm_lbs, top_weight_lbs: ex.top_set_weight_lbs, workout_name: w.workout_name })
      }
    }
    return h
  }, [workouts])
  const fmtDate = s => {
    const diff = (Date.now() - new Date(s)) / 86400000
    if (diff < 1) return 'Today'
    if (diff < 2) return 'Yesterday'
    if (diff < 7) return new Date(s).toLocaleDateString('en', { weekday:'long' })
    return new Date(s).toLocaleDateString('en', { month:'short', day:'numeric' })
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {workouts.slice(0, 10).map((w, i) => {
        const open  = openId === (w.id || w.external_id)
        const color = TC.strength
        const volLbs = w.total_volume_lbs || 0
        const muscles = (Array.isArray(w.muscle_groups) ? w.muscle_groups : []).slice(0, 5)

        return (
          <motion.div key={w.id || w.external_id || i}
            initial={{ opacity:0, x:-12 }} animate={{ opacity:1, x:0 }}
            transition={{ duration:0.35, delay:i*0.05 }}
            onClick={() => setOpenId(open ? null : (w.id || w.external_id))}
            style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:12, padding:'12px 14px 12px 16px', position:'relative', cursor:'pointer' }}>
            <span style={{ position:'absolute', left:0, top:10, bottom:10, width:3, borderRadius:2, background:color }}/>

            {/* Row summary */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:12, alignItems:'center' }}>
              <div>
                <div style={{ fontFamily:'var(--fd-mono)', fontSize:10, color, letterSpacing:'.14em', textTransform:'uppercase' }}>
                  {w.workout_date || w.started_at?.slice(0,10)}
                </div>
                <div style={{ fontSize:14, color:'var(--fd-ink1)', marginTop:2 }}>{w.workout_name}</div>
                {muscles.length > 0 && (
                  <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:5 }}>
                    {muscles.map(m => (
                      <span key={m} style={{ fontFamily:'var(--fd-mono)', fontSize:9, color:'var(--fd-ink3)', background:'rgba(255,255,255,0.06)', borderRadius:4, padding:'2px 6px', letterSpacing:'.06em' }}>
                        {m.replace(/_/g,' ')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ textAlign:'right', fontFamily:'var(--fd-mono)', fontSize:13, color:'var(--fd-ink1)', minWidth:72 }}>
                <b>{volLbs > 0 ? Math.round(volLbs/1000*10)/10+'k' : '—'}</b>
                <small style={{ display:'block', fontSize:10, color:'var(--fd-ink3)', marginTop:2 }}>lbs vol.</small>
              </div>
              <div style={{ textAlign:'right', fontFamily:'var(--fd-mono)', fontSize:13, color:'var(--fd-ink1)', minWidth:40 }}>
                <b>{w.duration_secs ? Math.round(w.duration_secs/60) : '—'}</b>
                <small style={{ display:'block', fontSize:10, color:'var(--fd-ink3)', marginTop:2 }}>min</small>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                style={{ color:'var(--fd-ink3)', transition:'transform .25s', transform:open?'rotate(180deg)':'none' }}>
                <path d="M3 5 L7 9 L11 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>

            {/* Expanded exercises */}
            <div style={{ display:'grid', gridTemplateRows:open?'1fr':'0fr', opacity:open?1:0, transition:'grid-template-rows .28s cubic-bezier(.2,.7,.2,1),opacity .22s' }}>
              <div style={{ minHeight:0, overflow:'hidden' }}>
                <div style={{ borderTop:'1px dashed rgba(255,255,255,0.06)', marginTop:12, paddingTop:12, display:'flex', flexDirection:'column', gap:10 }}>
                  {(w.exercises || []).map((ex, ei) => {
                    const primary   = ex.muscle_groups?.primary   || []
                    const secondary = ex.muscle_groups?.secondary || []
                    const topW      = ex.top_set_weight_lbs
                    const topR      = ex.top_set_reps
                    const topStr    = topW ? `${topW} lbs${topR?` × ${topR}`:''}` : (ex.sets?.[0]?.weight_lbs ? `${ex.sets[0].weight_lbs} lbs` : '—')

                    const exKey   = `${w.id||w.external_id}::${ex.name}`
                    const exOpen  = openEx === exKey
                    const prRow   = exercisePRs[ex.name]
                    const history = exerciseHistory[ex.name] || []
                    // PR: actual best weight set ever (not estimated 1RM)
                    const isPR    = prRow && ex.top_set_weight_lbs && ex.top_set_weight_lbs >= (prRow.best_weight_lbs||0)
                    // Chart uses actual top weight lifted per session
                    const histPoints = history.map(h => ({
                      label: h.date, shortLabel: h.date?.slice(5),
                      value: h.top_weight_lbs || h.e1rm_lbs || 0,
                    }))
                    const prHistIdx = histPoints.reduce((bi,p,i) => p.value > (histPoints[bi]?.value||0) ? i : bi, 0)
                    const hasHistory = histPoints.length > 1

                    return (
                      <div key={ei} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', paddingBottom:8, marginBottom:4 }}>
                        {/* Exercise header — clickable to show PR + history */}
                        <div onClick={e=>{e.stopPropagation();setOpenEx(exOpen?null:exKey)}}
                          style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:8, alignItems:'center', fontFamily:'var(--fd-mono)', fontSize:10.5, marginBottom:4, cursor:'pointer' }}>
                          <span style={{ color:'var(--fd-ink1)', fontSize:12, display:'flex', alignItems:'center', gap:6 }}>
                            {isPR && <span style={{ background:ORANGE, color:'#0e0c0a', borderRadius:4, fontSize:9, padding:'1px 5px', letterSpacing:'.06em', fontWeight:700 }}>🏆 PR</span>}
                            {ex.name}
                            {hasHistory && !exOpen && (
                              <span style={{ fontFamily:'var(--fd-mono)', fontSize:9, color:'var(--fd-ink3)', background:'rgba(255,255,255,0.06)', borderRadius:4, padding:'1px 5px', letterSpacing:'.06em' }}>
                                ↗ {histPoints.length}×
                              </span>
                            )}
                          </span>
                          <span style={{ color:ORANGE, whiteSpace:'nowrap' }}>{topStr}</span>
                          <span style={{ color:'var(--fd-ink3)', whiteSpace:'nowrap' }}>{ex.total_sets} sets</span>
                          {/* All-time PR (actual weight × reps, not estimated 1RM) */}
                          <span style={{ minWidth:68, textAlign:'right', whiteSpace:'nowrap' }}>
                            {prRow?.best_weight_lbs
                              ? <><b style={{ color:ORANGE }}>{prRow.best_weight_lbs}</b><span style={{ color:'var(--fd-ink3)' }}> ×{prRow.best_reps} PR</span></>
                              : ex.top_set_weight_lbs
                                ? <><b style={{ color:'var(--fd-ink2)' }}>{ex.top_set_weight_lbs}</b><span style={{ color:'var(--fd-ink3)' }}> ×{ex.top_set_reps}</span></>
                                : null}
                          </span>
                        </div>
                        {/* Muscle chips */}
                        {(primary.length > 0 || secondary.length > 0) && (
                          <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
                            {primary.map(m => <span key={m} style={{ fontSize:9, fontFamily:'var(--fd-mono)', background:`${MUSCLE_COLORS[m]||'rgba(255,255,255,0.1)'}22`, color:MUSCLE_COLORS[m]||'var(--fd-ink3)', borderRadius:4, padding:'2px 6px', border:`1px solid ${MUSCLE_COLORS[m]||'rgba(255,255,255,0.1)'}44` }}>{m.replace(/_/g,' ')}</span>)}
                            {secondary.map(m => <span key={m} style={{ fontSize:9, fontFamily:'var(--fd-mono)', background:'rgba(255,255,255,0.04)', color:'var(--fd-ink3)', borderRadius:4, padding:'2px 6px' }}>{m.replace(/_/g,' ')}</span>)}
                          </div>
                        )}
                        {/* Per-set chips */}
                        {(ex.sets || []).filter(s => !s.is_warmup).length > 0 && (
                          <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:4 }}>
                            {(ex.sets || []).map((s, si) => (
                              <div key={si} style={{ fontFamily:'var(--fd-mono)', fontSize:9.5, padding:'3px 8px', borderRadius:6,
                                background: s.is_warmup ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)',
                                color: s.is_warmup ? 'var(--fd-ink3)' : 'var(--fd-ink2)',
                                border: s.is_dropset ? `1px solid ${ORANGE}55` : '1px solid rgba(255,255,255,0.06)',
                                opacity: s.is_warmup ? 0.6 : 1 }}>
                                {s.weight_lbs ? `${s.weight_lbs}` : 'BW'}{s.reps ? `×${s.reps}` : ''}
                                {s.is_warmup && <span style={{ fontSize:8, marginLeft:3, color:'var(--fd-ink3)' }}>W</span>}
                                {s.is_dropset && <span style={{ fontSize:8, marginLeft:3, color:ORANGE }}>↓</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {ex.volume_lbs > 0 && (
                          <div style={{ fontFamily:'var(--fd-mono)', fontSize:9.5, color:'var(--fd-ink3)' }}>
                            {ex.volume_lbs.toLocaleString()} lbs volume
                          </div>
                        )}
                        {/* Expandable PR + progress chart — AnimatePresence avoids nested overflow:hidden clipping */}
                        <AnimatePresence initial={false}>
                          {exOpen && (
                            <motion.div
                              key="ex-detail"
                              initial={{ opacity:0, height:0 }}
                              animate={{ opacity:1, height:'auto' }}
                              exit={{ opacity:0, height:0 }}
                              transition={{ duration:0.28, ease:[0.2,0.7,0.2,1] }}
                              style={{ overflow:'hidden' }}>
                              <div style={{ borderTop:'1px solid rgba(255,255,255,0.06)', marginTop:8, paddingTop:12, display:'grid', gridTemplateColumns: histPoints.length ? '1fr 1fr' : '1fr', gap:16 }}>
                                {/* PR stats */}
                                <div>
                                  <div style={{ fontFamily:'var(--fd-mono)', fontSize:9.5, color:'var(--fd-ink3)', letterSpacing:'.1em', textTransform:'uppercase', marginBottom:8 }}>All-time PR</div>
                                  {prRow ? (
                                    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                                      <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                                        <span style={{ fontFamily:'var(--fd-serif)', fontSize:32, color:ORANGE, letterSpacing:'-0.02em', lineHeight:1 }}>{prRow.best_weight_lbs ?? ex.top_set_weight_lbs}</span>
                                        <span style={{ fontFamily:'var(--fd-mono)', fontSize:11, color:'var(--fd-ink3)' }}>lbs</span>
                                      </div>
                                      {prRow.best_reps && <div style={{ fontFamily:'var(--fd-mono)', fontSize:15, color:'var(--fd-ink1)' }}>× {prRow.best_reps} reps</div>}
                                      <div style={{ fontFamily:'var(--fd-mono)', fontSize:10, color:'var(--fd-ink3)', marginTop:2 }}>set {prRow.achieved_at}</div>
                                      {prRow.best_e1rm_lbs && <div style={{ fontFamily:'var(--fd-mono)', fontSize:9.5, color:'rgba(255,255,255,0.25)' }}>est. 1RM ~{prRow.best_e1rm_lbs} lbs</div>}
                                      {isPR && <div style={{ fontFamily:'var(--fd-mono)', fontSize:10, color:ORANGE, marginTop:2 }}>← This session is the PR! 🎉</div>}
                                    </div>
                                  ) : (
                                    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                                      <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                                        <span style={{ fontFamily:'var(--fd-serif)', fontSize:32, color:'var(--fd-ink2)', letterSpacing:'-0.02em', lineHeight:1 }}>{ex.top_set_weight_lbs ?? '—'}</span>
                                        <span style={{ fontFamily:'var(--fd-mono)', fontSize:11, color:'var(--fd-ink3)' }}>lbs</span>
                                      </div>
                                      {ex.top_set_reps && <div style={{ fontFamily:'var(--fd-mono)', fontSize:15, color:'var(--fd-ink1)' }}>× {ex.top_set_reps} reps</div>}
                                      <div style={{ fontFamily:'var(--fd-mono)', fontSize:10, color:'var(--fd-ink3)', marginTop:2 }}>this session · no DB cache yet</div>
                                    </div>
                                  )}
                                </div>
                                {/* Progress bars — show for any exercise with ≥1 history point */}
                                {histPoints.length >= 1 && (
                                  <MiniProgressBars points={histPoints} color={TC.strength} label="Top weight history" prIdx={prHistIdx} fmtVal={v=>`${v} lbs`}/>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

// ── GymVerse-style SVG line + area chart ─────────────────────────────────────
// floor  — y-axis minimum value (default 0; set to data min for pace charts)
// yFmt   — custom y-axis tick label formatter (default: round to integer)
// prLabel — text shown above the PR dot (default "PR")
function ExerciseLineChart({ points, color = ORANGE, prIdx = -1, floor = 0, yFmt = null, prLabel = 'PR' }) {
  const containerRef = useRef(null)
  const [w, setW] = useState(240)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setW(el.clientWidth || 240)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!points.length) return null

  const h   = 112
  const pL  = 6          // left padding
  const pR  = 40         // right padding for y-axis labels (wider for MM:SS pace)
  const pT  = 22         // top padding (room for PR label)
  const pB  = 20         // bottom padding for x-axis labels
  const cW  = Math.max(1, w - pL - pR)
  const cH  = h - pT - pB

  const vals = points.map(p => p.value)
  const maxV = Math.max(...vals)
  // Compute a clean ceiling above floor
  const span = maxV - floor
  const ceil = floor + (span <= 0 ? 1 : (() => {
    const mag = Math.pow(10, Math.floor(Math.log10(span)))
    return Math.ceil(span / mag) * mag
  })())

  const range = Math.max(ceil - floor, 1)
  const xAt = i => pL + (points.length <= 1 ? cW / 2 : (i / (points.length - 1)) * cW)
  const yAt = v  => pT + cH - Math.min(1, Math.max(0, (v - floor) / range)) * cH

  // Y-axis: 4 ticks evenly from floor → ceil
  const yTicks = [0, 1, 2, 3].map(n => floor + Math.round((ceil - floor) * n / 3))

  // SVG path strings
  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(' ')
  const areaD = `${lineD} L ${xAt(points.length-1).toFixed(1)},${(pT+cH).toFixed(1)} L ${xAt(0).toFixed(1)},${(pT+cH).toFixed(1)} Z`

  // X-axis: at most 4 evenly spaced labels
  const xLabelIdxs = (() => {
    const n = points.length
    if (n <= 1) return [0]
    if (n <= 3) return [...Array(n).keys()]
    const step = (n - 1) / 3
    return [0, 1, 2, 3].map(i => Math.round(i * step))
  })()

  const gradId = `elc-${color.replace(/[^a-z0-9]/gi,'').slice(0,12)}-${w|0}`

  return (
    <div ref={containerRef} style={{ width:'100%' }}>
      <svg width={w} height={h} style={{ display:'block', overflow:'visible' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.38"/>
            <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
          </linearGradient>
        </defs>

        {/* Horizontal dashed grid lines */}
        {yTicks.slice(1).map((t, i) => (
          <line key={i}
            x1={pL} y1={yAt(t)} x2={w - pR} y2={yAt(t)}
            stroke="rgba(255,255,255,0.07)" strokeWidth="1" strokeDasharray="3 5"/>
        ))}

        {/* Area fill — fade in */}
        <motion.path d={areaD} fill={`url(#${gradId})`}
          initial={{ opacity:0 }} animate={{ opacity:1 }}
          transition={{ duration:0.5, delay:0.2 }}/>

        {/* Line — draw-on animation */}
        <motion.path d={lineD} fill="none" stroke={color} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength:0, opacity:0 }} animate={{ pathLength:1, opacity:1 }}
          transition={{ duration:1.1, ease:[0.2,0.7,0.2,1] }}/>

        {/* Y-axis labels (right side) */}
        {yTicks.map((t, i) => (
          <text key={i} x={w - pR + 6} y={yAt(t) + 3.5}
            textAnchor="start" fontFamily="var(--fd-mono)"
            fontSize="9" fill="rgba(255,255,255,0.3)">
            {yFmt ? yFmt(t) : Math.round(t)}
          </text>
        ))}

        {/* X-axis date labels */}
        {xLabelIdxs.map((idx, pos) => (
          <text key={idx} x={xAt(idx)} y={h - 3}
            textAnchor={pos === 0 ? 'start' : pos === xLabelIdxs.length - 1 ? 'end' : 'middle'}
            fontFamily="var(--fd-mono)" fontSize="8.5" fill="rgba(255,255,255,0.28)">
            {points[idx].shortLabel || points[idx].label?.slice(5) || points[idx].label}
          </text>
        ))}

        {/* Data-point dots + PR annotation */}
        {points.map((p, i) => {
          const cx = xAt(i), cy = yAt(p.value), isPR = i === prIdx
          return (
            <g key={i}>
              <motion.circle cx={cx} cy={cy}
                r={isPR ? 5 : 3}
                fill={isPR ? ORANGE : '#161412'}
                stroke={isPR ? ORANGE : color}
                strokeWidth={isPR ? 0 : 1.8}
                initial={{ opacity:0 }} animate={{ opacity:1 }}
                transition={{ delay:0.35 + i * 0.07, duration:0.25 }}/>
              {isPR && (
                <motion.text x={cx} y={cy - 10}
                  textAnchor="middle"
                  fontFamily="var(--fd-mono)" fontSize="9" fontWeight="700"
                  fill={ORANGE} letterSpacing="0.08em"
                  initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }}
                  transition={{ delay:0.75, duration:0.35 }}>
                  {prLabel}
                </motion.text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Strength population percentile ───────────────────────────────────────────
// Returns { percentile, tier, label, approx } or null for unknown exercises.
// Based on ExRx normative standards mapped to world adult population.
// World mapping rationale: ~70 % of adults lift nothing at all, so even "Untrained"
// (can do the movement) already beats the majority.
function computeStrengthPercentile(exerciseName, weightLbs, bwLbs = 185) {
  const n = exerciseName.toLowerCase()

  // ── canonical detection ──────────────────────────────────────────────────
  let canon = null, approx = false
  if      (/(barbell bench press|dumbbell bench press|incline.*press|decline.*press|chest press)/.test(n) && !/machine/.test(n)) canon = 'bench'
  else if (/deadlift/.test(n))                                 canon = 'deadlift'
  else if (/(barbell squat|back squat|front squat)/.test(n))   canon = 'squat'
  else if (/leg press/.test(n))                                canon = 'legpress'
  else if (/(overhead press|shoulder press|military press|ohp)/.test(n) && !/machine/.test(n)) canon = 'ohp'
  else if (/lat pull.?down|pulldown/.test(n))                  { canon = 'pulldown'; approx = true }
  else if (/(bent.over row|barbell row|cable row|seated.*row|chest.*supported.*row)/.test(n))  { canon = 'row'; approx = true }
  else if (/(pull.?up|chin.?up)/.test(n))                      { canon = 'pullup';   approx = true }
  else if (/(curl|pushdown|extension|raise|fly|kickback|pullover|hip thrust|dip|press machine|fly machine)/.test(n)) { canon = 'isolation'; approx = true }
  else if (/(machine|selector|plate loaded|cable)/.test(n))    { canon = 'machine';  approx = true }

  if (!canon) return null

  // ── ExRx BW multipliers: [untrained, novice, intermediate, advanced, elite] ─
  const STD = {
    bench:     [0.50, 0.75, 1.00, 1.25, 1.50],
    deadlift:  [1.00, 1.25, 1.50, 1.75, 2.00],
    squat:     [0.75, 1.00, 1.25, 1.50, 1.75],
    legpress:  [1.00, 1.50, 2.00, 2.50, 3.00],
    ohp:       [0.35, 0.55, 0.70, 0.85, 1.00],
    pulldown:  [0.50, 0.70, 0.85, 1.00, 1.20],
    row:       [0.50, 0.65, 0.80, 1.00, 1.20],
    pullup:    [0.40, 0.60, 0.80, 1.00, 1.20],   // added BW
    isolation: [0.20, 0.35, 0.50, 0.65, 0.80],
    machine:   [0.75, 1.00, 1.50, 2.00, 2.50],
  }

  // World adult percentile at each tier boundary
  const TIER_PCT  = [69, 82, 91, 96, 99]
  const TIER_NAME = ['Recreational', 'Active', 'Gym-fit', 'Athletic', 'Elite']

  const std   = STD[canon]
  const ratio = weightLbs / bwLbs

  // Below first tier: linear 40 → 69
  if (ratio < std[0]) {
    const pct = Math.round(40 + (ratio / std[0]) * 29)
    return { percentile: Math.max(1, pct), tier: 'Beginner', approx }
  }

  // Interpolate between tiers
  for (let i = 0; i < std.length - 1; i++) {
    if (ratio >= std[i] && ratio < std[i + 1]) {
      const t   = (ratio - std[i]) / (std[i + 1] - std[i])
      const pct = Math.round(TIER_PCT[i] + t * (TIER_PCT[i + 1] - TIER_PCT[i]))
      return { percentile: pct, tier: TIER_NAME[i], approx }
    }
  }

  // Above elite
  return { percentile: 99, tier: 'Elite', approx }
}

// ── Single collapsible exercise card ─────────────────────────────────────────
function ExerciseCard({ name, hist, prRow, bodyweightLbs, animDelay = 0 }) {
  const [open, setOpen] = useState(false)

  const hasWeight   = hist.some(h => h.top_weight_lbs)
  const bestW = prRow?.best_weight_lbs ?? (hasWeight ? Math.max(...hist.map(h => h.top_weight_lbs||0)) : null)
  const bestR = prRow?.best_reps ?? hist.reduce((mx, h) => Math.max(mx, h.top_reps||0), 0) || null
  const first = hist[0]

  const trendPct = hasWeight && hist.length > 1 && first.top_weight_lbs
    ? Math.round(((hist.at(-1).top_weight_lbs - first.top_weight_lbs) / first.top_weight_lbs) * 100)
    : null

  const pctInfo = bestW ? computeStrengthPercentile(name, bestW, bodyweightLbs || 185) : null
  const pct     = pctInfo?.percentile ?? null

  const barColor = !pct ? 'rgba(255,255,255,0.2)'
    : pct >= 96 ? ORANGE
    : pct >= 91 ? 'var(--good)'
    : pct >= 82 ? 'var(--warn)'
    : 'rgba(255,255,255,0.3)'

  // Chart: prefer weight axis; fall back to reps for bodyweight exercises
  const points = hist.map(h => ({
    label:      h.date,
    shortLabel: h.date?.slice(5),
    value:      h.top_weight_lbs ?? 0,
  }))
  const repsPoints = hist.map(h => ({
    label:      h.date,
    shortLabel: h.date?.slice(5),
    value:      h.top_reps ?? 0,
  }))
  const prIdx = points.reduce((bi,p,i) => p.value > (points[bi]?.value||0) ? i : bi, 0)

  return (
    <motion.div
      initial={{ opacity:0, y:14 }} animate={{ opacity:1, y:0 }}
      transition={{ duration:0.4, delay:animDelay, ease:[0.2,0.7,0.2,1] }}
      style={{
        background: open ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.025)',
        border: `1px solid ${open ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: 14, overflow: 'hidden',
        transition: 'background 0.2s, border-color 0.2s', cursor: 'pointer',
      }}
      onClick={() => setOpen(v => !v)}>

      {/* ── Collapsed body ── */}
      <div style={{ padding:'14px 16px' }}>

        {/* Row 1: name + chevron */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:6, marginBottom:10 }}>
          <div style={{
            fontSize:11.5, color:'var(--fd-ink2)', lineHeight:1.35, flex:1, minWidth:0,
            overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical',
          }}>
            {name}
          </div>
          <span style={{ fontFamily:'var(--fd-mono)', fontSize:10, color:'var(--fd-ink3)', flexShrink:0, marginTop:1 }}>
            {open ? '▲' : '▼'}
          </span>
        </div>

        {/* Row 2: big PR stat */}
        {hasWeight ? (
          <div style={{ display:'flex', alignItems:'baseline', gap:6, marginBottom:10 }}>
            <span style={{ fontFamily:'var(--fd-serif)', fontSize:36, color:ORANGE, letterSpacing:'-0.03em', lineHeight:1 }}>
              {bestW}
            </span>
            {bestR > 0 && (
              <span style={{ fontFamily:'var(--fd-mono)', fontSize:13, color:'var(--fd-ink2)' }}>× {bestR}</span>
            )}
            <span style={{ fontFamily:'var(--fd-mono)', fontSize:10, color:'var(--fd-ink3)', marginLeft:2 }}>lbs · PR</span>
          </div>
        ) : (
          /* Reps-only / bodyweight exercise */
          <div style={{ display:'flex', alignItems:'baseline', gap:6, marginBottom:10 }}>
            {bestR > 0 ? (
              <>
                <span style={{ fontFamily:'var(--fd-serif)', fontSize:36, color:'var(--fd-ink2)', letterSpacing:'-0.03em', lineHeight:1 }}>
                  {bestR}
                </span>
                <span style={{ fontFamily:'var(--fd-mono)', fontSize:10, color:'var(--fd-ink3)', marginLeft:2 }}>reps · best</span>
              </>
            ) : (
              <span style={{ fontFamily:'var(--fd-mono)', fontSize:11, color:'rgba(255,255,255,0.25)', lineHeight:1.6 }}>
                {hist.length} session{hist.length !== 1 ? 's' : ''} tracked
              </span>
            )}
          </div>
        )}

        {/* Row 3: percentile bar (weighted) or session/trend info (bodyweight) */}
        {pct !== null ? (
          <div>
            <div style={{ height:4, borderRadius:2, background:'rgba(255,255,255,0.08)', overflow:'hidden', marginBottom:5 }}>
              <motion.div
                initial={{ width:0 }} animate={{ width:`${pct}%` }}
                transition={{ duration:0.9, delay:animDelay + 0.2, ease:[0.2,0.7,0.2,1] }}
                style={{ height:'100%', borderRadius:2, background:barColor }}/>
            </div>
            <div style={{ fontFamily:'var(--fd-mono)', fontSize:9.5, color:'var(--fd-ink3)' }}>
              <span style={{ color: barColor, fontWeight:600 }}>{pct}%</span>
              {' '}stronger than all adults worldwide
              {pctInfo.approx && <span style={{ color:'rgba(255,255,255,0.2)', marginLeft:4 }}>(est.)</span>}
              <span style={{ float:'right', color:'rgba(255,255,255,0.3)' }}>{pctInfo.tier}</span>
            </div>
          </div>
        ) : (
          <div style={{ fontFamily:'var(--fd-mono)', fontSize:9, color:'rgba(255,255,255,0.2)', display:'flex', gap:8, alignItems:'center' }}>
            <span>{hist.length} session{hist.length !== 1 ? 's' : ''}</span>
            {trendPct !== null && (
              <span style={{ color: trendPct >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                {trendPct >= 0 ? '+' : ''}{trendPct}%
              </span>
            )}
            {!hasWeight && <span style={{ marginLeft:'auto', color:'rgba(255,255,255,0.15)' }}>bodyweight</span>}
          </div>
        )}
      </div>

      {/* ── Expanded: timeline chart ── */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="chart"
            initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }}
            exit={{ height:0, opacity:0 }}
            transition={{ duration:0.3, ease:[0.2,0.7,0.2,1] }}
            style={{ overflow:'hidden' }}>
            <div style={{ borderTop:'1px solid rgba(255,255,255,0.07)', padding:'12px 16px 14px' }}>
              <div style={{ fontFamily:'var(--fd-mono)', fontSize:9, color:'var(--fd-ink3)', letterSpacing:'.12em', textTransform:'uppercase', marginBottom:8 }}>
                Progress — {hist.length} session{hist.length !== 1 ? 's' : ''}
                {trendPct !== null && (
                  <span style={{ color: trendPct >= 0 ? 'var(--good)' : 'var(--bad)', marginLeft:8, letterSpacing:0 }}>
                    {trendPct >= 0 ? '+' : ''}{trendPct}% overall
                  </span>
                )}
              </div>
              {hasWeight
                ? <ExerciseLineChart points={points} color={TC.strength} prIdx={prIdx} yFmt={v=>`${v}lb`}/>
                : (bestR > 0
                    ? <ExerciseLineChart points={repsPoints} color='var(--fd-ink2)' prIdx={-1} yFmt={v=>`${v}r`} floor={0} prLabel="best"/>
                    : <div style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'rgba(255,255,255,0.2)',textAlign:'center',padding:'16px 0'}}>No rep data captured from photos</div>
                  )
              }
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Exercise progress grid (always-visible per-lift history) ─────────────────
function ExerciseProgressGrid({ workouts, exercisePRs = {}, bodyweightLbs }) {
  const history = useMemo(() => {
    const h = {}
    for (const w of [...workouts].sort((a,b) => (a.workout_date||a.started_at) < (b.workout_date||b.started_at) ? -1 : 1)) {
      for (const ex of (w.exercises||[])) {
        // Include every exercise that has a real name (even if weight is unknown)
        if (!ex.name || ex.name.toLowerCase().startsWith('unknown')) continue
        if (!h[ex.name]) h[ex.name] = []
        h[ex.name].push({
          date:           w.workout_date || w.started_at?.slice(0,10),
          top_weight_lbs: ex.top_set_weight_lbs || null,
          top_reps:       ex.top_set_reps || null,
        })
      }
    }
    return h
  }, [workouts])

  // Sort: weighted exercises first (sorted by sessions then weight),
  // then reps-only exercises (sorted by sessions)
  // No hard cap — show everything
  const exercises = Object.entries(history).sort((a, b) => {
    const aHasW = a[1].some(h => h.top_weight_lbs)
    const bHasW = b[1].some(h => h.top_weight_lbs)
    if (aHasW !== bHasW) return bHasW ? 1 : -1
    if (b[1].length !== a[1].length) return b[1].length - a[1].length
    return (b[1].at(-1)?.top_weight_lbs||0) - (a[1].at(-1)?.top_weight_lbs||0)
  })

  if (!exercises.length) return null

  return (
    <div style={{ display:'grid', gap:8, gridTemplateColumns:'repeat(auto-fill, minmax(200px,1fr))' }}>
      {exercises.map(([name, hist], ci) => (
        <ExerciseCard
          key={name}
          name={name}
          hist={hist}
          prRow={exercisePRs[name]}
          bodyweightLbs={bodyweightLbs}
          animDelay={ci * 0.04}
        />
      ))}
    </div>
  )
}

// ── Run pace trend (GymVerse-style line chart) ────────────────────────────────
function RunPaceTrendChart({ acts }) {
  const runs = useMemo(() =>
    acts
      .filter(a => ['run','Run'].includes(a.type) && a.distance_m > 0 && a.duration_secs > 0)
      .sort((a,b) => new Date(a.started_at) - new Date(b.started_at))
      .slice(-12)
  , [acts])

  if (runs.length < 2) return (
    <div style={{ fontFamily:'var(--fd-mono)', fontSize:11, color:'var(--fd-ink3)', textAlign:'center', padding:'20px 0' }}>
      Need 2+ runs to show pace trend
    </div>
  )

  const paceOf = a => a.duration_secs / (a.distance_m / 1000)   // seconds / km
  const paces  = runs.map(paceOf)
  const minP   = Math.min(...paces)
  const maxP   = Math.max(...paces)
  const fmtP   = secs => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}/km`

  // Invert values: faster pace (lower secs) → higher chart point
  // inv = maxP + minP − pace  →  fastest run gets inv = maxP (tallest), slowest gets inv = minP (shortest)
  const points = runs.map(a => ({
    label:      new Date(a.started_at).toLocaleDateString('en', { month:'2-digit', day:'2-digit' }),
    shortLabel: new Date(a.started_at).toLocaleDateString('en', { month:'2-digit', day:'2-digit' }),
    value:      maxP + minP - paceOf(a),
  }))

  // PR = fastest run index (highest inverted value)
  const prIdx      = paces.reduce((bi, p, i) => p < paces[bi] ? i : bi, 0)
  const latestPace = paceOf(runs.at(-1))
  const bestPace   = minP
  const diff       = latestPace - bestPace

  // Y-axis labels: convert inverted tick values back to real pace strings (strip "/km" for brevity)
  const yFmt = inv => {
    const real = maxP + minP - inv
    return `${Math.floor(real / 60)}:${String(Math.round(real % 60)).padStart(2, '0')}`
  }

  return (
    <div>
      {/* Header: "Run pace" left · best pace right */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:6 }}>
        <div style={{ fontSize:11.5, color:'var(--fd-ink1)', lineHeight:1.3 }}>Run pace trend</div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <div style={{ fontFamily:'var(--fd-serif)', fontSize:28, color:ORANGE, letterSpacing:'-0.02em', lineHeight:1 }}>
            {fmtP(bestPace).replace('/km', '')}
          </div>
          <div style={{ fontFamily:'var(--fd-mono)', fontSize:8.5, color:'var(--fd-ink3)', letterSpacing:'.06em', marginTop:1 }}>
            /KM BEST
          </div>
        </div>
      </div>

      {/* Line chart */}
      <ExerciseLineChart
        points={points}
        color={TC.run}
        prIdx={prIdx}
        floor={minP * 0.94}
        yFmt={yFmt}
        prLabel="BEST"/>

      {/* Footer */}
      <div style={{ display:'flex', justifyContent:'space-between', fontFamily:'var(--fd-mono)', fontSize:9, color:'var(--fd-ink3)', marginTop:4 }}>
        <span>{runs.length} runs tracked</span>
        <span>
          latest <b style={{ color: diff <= 0 ? 'var(--good)' : 'var(--fd-ink2)' }}>{fmtP(latestPace)}</b>
          {diff > 0 && <span style={{ color:'var(--bad)', marginLeft:4 }}>+{fmtP(diff)} off best</span>}
          {diff <= 0 && <span style={{ color:'var(--good)', marginLeft:4 }}>🏆 PB</span>}
        </span>
      </div>
    </div>
  )
}

// ── Streak badge ──────────────────────────────────────────────────────────────
function StreakBadge({streak}){
  const {days=0,weeks=0}=streak||{}
  if(days<1) return null
  return(
    <motion.div initial={{scale:0.8,opacity:0}} animate={{scale:1,opacity:1}} transition={{type:'spring',stiffness:260,damping:20,delay:0.4}}
      style={{display:'inline-flex',alignItems:'center',gap:10,background:`linear-gradient(135deg,${ORANGE}18,${ORANGE}08)`,border:`1px solid ${ORANGE}44`,borderRadius:12,padding:'10px 16px'}}>
      <motion.span animate={{rotate:[0,-10,10,-10,0]}} transition={{delay:0.8,duration:0.5,ease:'easeInOut'}} style={{fontSize:22,lineHeight:1}}>🔥</motion.span>
      <div>
        {/* Daily streak — primary */}
        <div style={{display:'flex',alignItems:'baseline',gap:4}}>
          <span style={{fontFamily:'var(--fd-serif)',fontSize:26,letterSpacing:'-0.02em',lineHeight:1,color:ORANGE}}>{days}</span>
          <span style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)'}}>day{days!==1?'s':''}</span>
        </div>
        <div style={{fontFamily:'var(--fd-mono)',fontSize:9,color:'var(--fd-ink3)',letterSpacing:'.12em',marginTop:2}}>
          DAILY STREAK{weeks>0?` · ${weeks}wk`:''}
        </div>
        {streak.currentWeekActive&&(
          <div style={{fontFamily:'var(--fd-mono)',fontSize:9,color:'var(--good)',letterSpacing:'.1em',marginTop:1}}>✓ THIS WEEK ACTIVE</div>
        )}
      </div>
    </motion.div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function FitnessDashboard(){
  const{data,loading}=useDashboardData()
  const[tab,setTab]=useState('run')

  const wk         =useMemo(()=>data?thisWeekStats(data.acts,data.metrics):null,[data])
  const weeklyData =useMemo(()=>data?weeklyTotals(data.acts,8):[],[data])
  const trend30    =useMemo(()=>data?data.metrics.slice(-30):[],[data])
  const hmCells    =useMemo(()=>data?heatmapData(data.acts):[],[data])
  const streak     =useMemo(()=>data?computeStreak(data.acts):{days:0,weeks:0,currentWeekActive:false},[data])
  // Set of dates in the current daily streak (for heatmap highlight)
  const streakDays =useMemo(()=>{
    const s=new Set();const today=new Date();today.setHours(0,0,0,0)
    for(let i=0;i<(streak.days||0);i++){const d=new Date(today);d.setDate(d.getDate()-i);s.add(d.toISOString().slice(0,10))}
    return s
  },[streak.days])
  const[recovDur,setRecovDur]=useState('1m')
  const[wkDur,setWkDur]=useState('1m')
  const recovData  =useMemo(()=>sliceByDuration(data?.metrics??[],recovDur),[data,recovDur])
  const weeklyBarsData=useMemo(()=>{
    if(!data)return[]
    const n=wkDur==='7d'?1:wkDur==='1m'?4:wkDur==='6m'?26:52
    return weeklyTotals(data.acts,n)
  },[data,wkDur])
  const counts     =useMemo(()=>{
    if(!wk)return{}
    const c={all:wk.weekActivities.length}
    wk.weekActivities.forEach(a=>c[a.type]=(c[a.type]||0)+1)
    return c
  },[wk])
  const totalKm    =useMemo(()=>data?+(data.acts.reduce((s,a)=>s+(a.distance_m||0),0)/1000).toFixed(0):0,[data])

  useEffect(()=>{if(wk?.mostFreqType)setTab(wk.mostFreqType)},[wk?.mostFreqType])

  const recoveryColors={recovered:'var(--good)',moderate:'var(--warn)',fatigued:'var(--bad)',unknown:'var(--fd-ink3)'}
  const recoveryLabels={recovered:'Recovered',moderate:'Moderate load',fatigued:'Fatigued',unknown:'—'}

  if(loading) return(
    <div style={{background:'#161412',minHeight:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'rgba(255,255,255,0.3)',fontFamily:'"JetBrains Mono",monospace',fontSize:11,letterSpacing:'.16em'}}>
      LOADING DASHBOARD…
    </div>
  )

  const today=new Date()

  return(
    <div className="fd" style={{background:'#161412',minHeight:'100%',color:'#f7f5f1'}}>
      <Ticker acts={data.acts} metrics={data.metrics}/>

      <div style={{maxWidth:1320,margin:'0 auto',padding:'clamp(20px,3vw,40px) clamp(16px,3vw,40px) 80px'}}>

        {/* ── Header ── */}
        <motion.div initial={{opacity:0,y:-14}} animate={{opacity:1,y:0}} transition={{duration:0.55,ease:[0.2,0.7,0.2,1]}}
          style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:24,paddingBottom:24,borderBottom:'1px solid rgba(255,255,255,0.06)',marginBottom:0}}>
          <div>
            <div style={{fontFamily:'"JetBrains Mono",monospace',fontSize:11,color:'rgba(255,255,255,0.3)',letterSpacing:'.1em',textTransform:'uppercase',marginBottom:10}}>
              Fitness · {today.toLocaleDateString('en',{weekday:'long',month:'long',day:'numeric'})}
            </div>
            <h1 style={{fontFamily:'"Instrument Serif","Times New Roman",serif',fontWeight:400,margin:0,fontSize:'clamp(40px,5vw,64px)',letterSpacing:'-0.025em',lineHeight:1,color:'#f7f5f1'}}>
              Body <em style={{color:'rgba(255,255,255,0.45)'}}>of work.</em>
            </h1>
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:10}}>
            <StreakBadge streak={streak}/>
            <div style={{fontFamily:'"JetBrains Mono",monospace',fontSize:11,color:'rgba(255,255,255,0.35)',letterSpacing:'.06em',lineHeight:1.7,textAlign:'right'}}>
              <div><b style={{color:'#f7f5f1'}}>Rahul Pyne</b></div>
              <div>{data.acts.length} activities · {totalKm} km lifetime</div>
              <div style={{color:recoveryColors[wk?.recoveryStatus||'unknown'],marginTop:2}}>
                ● {recoveryLabels[wk?.recoveryStatus||'unknown']}
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── 01 This week ── */}
        <div style={{marginTop:40}}>
          <SectionHead num="01" label="Snapshot" title={<>This <em style={{color:'rgba(255,255,255,0.45)'}}>week.</em></>}
            right={wk&&<span style={{display:'inline-flex',alignItems:'center',gap:6,border:`1px solid ${recoveryColors[wk.recoveryStatus]}44`,borderRadius:999,padding:'4px 10px',color:recoveryColors[wk.recoveryStatus]}}><span style={{width:6,height:6,borderRadius:'50%',background:recoveryColors[wk.recoveryStatus],display:'inline-block'}}/>{recoveryLabels[wk.recoveryStatus]}</span>}/>
          <div style={{display:'grid',gap:12,gridTemplateColumns:'repeat(5,1fr)'}}>
            <StatTile idx={0} type="distance"    label="Distance — wk"  value={wk?.distKm??0}   unit="km"  dec={1} delta={wk?.deltas.dist}  spark={weeklyData.map(d=>d.total_km)}/>
            <StatTile idx={1} type="active_days" label="Active days"     value={wk?.days??0}     unit="/ 7"        delta={wk?.deltas.days}/>
            <StatTile idx={2} type="hrv"         label="Avg HRV"         value={wk?.avgHRV??null} unit="ms"        delta={wk?.deltas.hrv}   spark={trend30.map(d=>d.hrv||0)}/>
            <StatTile idx={3} type="resting_hr"  label="Resting HR"      value={wk?.restHR??null} unit="bpm"       delta={wk?.deltas.hr}    spark={trend30.map(d=>d.resting_hr||0)}/>
            <StatTile idx={4} type="sleep"       label="Avg sleep"       value={wk?.avgSleep??null} unit="hrs" dec={1} delta={wk?.deltas.sleep} spark={trend30.map(d=>d.sleep_hrs||0)}/>
          </div>
        </div>

        {/* ── 02 Activity focus ── */}
        <div style={{marginTop:48}}>
          <SectionHead num="02" label="By type" title={<>Activity <em style={{color:'rgba(255,255,255,0.45)'}}>focus.</em></>}/>
          <div style={{marginBottom:14}}><SportTabs value={tab} onChange={setTab} counts={counts}/></div>
          <div style={{display:'grid',gap:14,gridTemplateColumns:'5fr 7fr'}}>
            <FocusStage tab={tab} weekActs={wk?.weekActivities??[]}/>
            <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20,minHeight:360,backdropFilter:'blur(12px)'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontFamily:'"JetBrains Mono",monospace',fontSize:10.5,color:'rgba(255,255,255,0.35)',letterSpacing:'.16em',textTransform:'uppercase',marginBottom:16}}>
                <span>Weekly distance</span>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <span style={{color:ORANGE}}>● this week</span>
                  <DurationPill value={wkDur} onChange={setWkDur}/>
                </div>
              </div>
              <WeeklyBars data={weeklyBarsData}/>
            </div>
          </div>
        </div>

        {/* ── 03 Routes map ── */}
        <div style={{marginTop:48}}>
          <SectionHead num="03" label="GPS routes" title={<>Route <em style={{color:'rgba(255,255,255,0.45)'}}>map.</em></>}
            right={data.routes.length?<><b style={{color:'#f7f5f1'}}>{data.routes.length}</b> mapped routes</>:'No routes yet'}/>
          {data.routes.length>0
            ? <RouteMap routes={data.routes}/>
            : <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:40,textAlign:'center',color:'var(--fd-ink3)',fontFamily:'var(--fd-mono)',fontSize:11}}>
                Route data loads from Strava activities. Re-sync to pick up GPS tracks.
              </div>
          }
        </div>

        {/* ── 04 Heat map ── */}
        <div style={{marginTop:48}}>
          <SectionHead num="04" label="Consistency" title={<>Heat <em style={{color:'rgba(255,255,255,0.45)'}}>map.</em></>}
            right={<><b style={{color:'#f7f5f1'}}>{hmCells.filter(c=>c.cals>0).length}</b> active days · <b style={{color:ORANGE}}>{streak.days}d</b> streak</>}/>
          <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20,backdropFilter:'blur(12px)'}} className="fd-heatmap-wrap">
            <Heatmap cells={hmCells} streakDays={streakDays}/>
          </div>
        </div>

        {/* ── 05 Apple Health ── */}
        {trend30.length>0&&(
          <div style={{marginTop:48}}>
            <SectionHead num="05" label="Apple Health" title={<>Health <em style={{color:'rgba(255,255,255,0.45)'}}>trends.</em></>}
              right={<span style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)'}}>Steps · Active Cals · VO₂ Max · Sleep stages · 30-day</span>}/>
            <HealthTrends daily={trend30}/>
          </div>
        )}

        {/* ── 06 Recovery & goals ── */}
        <div style={{marginTop:48}}>
          <SectionHead num={trend30.length>0?'06':'05'} label="30-day trend" title={<>Recovery & <em style={{color:'rgba(255,255,255,0.45)'}}>goals.</em></>}/>
          <div style={{display:'grid',gap:14,gridTemplateColumns:'7fr 5fr'}}>
            <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20,minHeight:320,backdropFilter:'blur(12px)'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontFamily:'"JetBrains Mono",monospace',fontSize:10.5,color:'rgba(255,255,255,0.35)',letterSpacing:'.16em',textTransform:'uppercase',marginBottom:16}}>
                <span>HRV vs Resting HR</span>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <span><span style={{color:'var(--good)',marginRight:12}}>● HRV</span><span style={{color:'var(--warn)'}}>● RHR</span></span>
                  <DurationPill value={recovDur} onChange={setRecovDur}/>
                </div>
              </div>
              <DualTrend daily={recovData}/>
            </div>
            <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20,backdropFilter:'blur(12px)'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontFamily:'"JetBrains Mono",monospace',fontSize:10.5,color:'rgba(255,255,255,0.35)',letterSpacing:'.16em',textTransform:'uppercase',marginBottom:16}}>
                <span>Active goals</span>
                <span>{data.goals.length}</span>
              </div>
              <Goals goals={data.goals}/>
            </div>
          </div>
        </div>

        {/* ── 07 Strength lab ── */}
        {data.gymverse?.length>0&&(()=>{
          const gv=data.gymverse
          const now=new Date(),cm=now.getMonth(),cy=now.getFullYear()
          const monthSessions=gv.filter(w=>{const d=new Date(w.started_at);return d.getMonth()===cm&&d.getFullYear()===cy})
          const monthVolLbs=Math.round(monthSessions.reduce((s,w)=>s+(w.total_volume_lbs||0),0))
          const allSets=gv.flatMap(w=>(w.exercises||[]).flatMap(ex=>ex.sets||[]))
          const totalSets=allSets.filter(s=>!s.is_warmup).length
          // Top PR: highest actual weight lifted (from DB cache), fallback to session data
          const prValues = Object.values(data.exercisePRs||{}).filter(p=>p.best_weight_lbs)
          const topPR = prValues.sort((a,b)=>(b.best_weight_lbs||0)-(a.best_weight_lbs||0))[0]
          const topPRVal = topPR ? `${topPR.best_weight_lbs}×${topPR.best_reps}` : (gv.flatMap(w=>(w.exercises||[]).map(ex=>ex.top_set_weight_lbs||0)).reduce((a,b)=>Math.max(a,b),0)||'—')
          const topPRUnit = topPR ? topPR.exercise_name.split(' ').slice(0,2).join(' ') : 'lbs'
          return(
          <div style={{marginTop:48}}>
            <SectionHead num="07" label="Strength lab" title={<>Strength <em style={{color:'rgba(255,255,255,0.45)'}}>analytics.</em></>}
              right={<span style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)'}}>{gv.length} sessions scraped from Strava photos · Gemini Vision</span>}/>

            {/* Summary stats */}
            <div style={{display:'grid',gap:12,gridTemplateColumns:'repeat(4,1fr)',marginBottom:14}}>
              {[
                {label:'Month volume',val:monthVolLbs>0?(monthVolLbs/1000).toFixed(1)+'k':'—',unit:'lbs',color:ORANGE},
                {label:'Sessions',val:gv.length,unit:'total',color:'var(--fd-ink1)'},
                {label:'Working sets',val:totalSets||'—',unit:'logged',color:'var(--fd-ink1)'},
                {label:'Top PR',val:topPRVal,unit:topPRUnit,color:'var(--good)'},
              ].map((s,i)=>(
                <motion.div key={i} initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.4,delay:i*0.07}}
                  style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:14,padding:'16px 18px'}}>
                  <div style={{fontFamily:'var(--fd-mono)',fontSize:10,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase',marginBottom:8}}>{s.label}</div>
                  <div style={{display:'flex',alignItems:'baseline',gap:5}}>
                    <span style={{fontFamily:'var(--fd-serif)',fontSize:32,letterSpacing:'-0.025em',lineHeight:1,color:s.color}}>{s.val}</span>
                    <span style={{fontFamily:'var(--fd-mono)',fontSize:11,color:'var(--fd-ink3)'}}>{s.unit}</span>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Volume timeline + Muscle frequency */}
            <div style={{display:'grid',gap:14,gridTemplateColumns:'7fr 5fr',marginBottom:14}}>
              <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20,backdropFilter:'blur(12px)'}}>
                <div style={{fontFamily:'var(--fd-mono)',fontSize:10.5,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase',marginBottom:14}}>
                  Weekly volume (lbs) · last 8 weeks
                </div>
                <StrengthVolumeChart workouts={gv}/>
              </div>
              <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20,backdropFilter:'blur(12px)'}}>
                <div style={{fontFamily:'var(--fd-mono)',fontSize:10.5,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase',marginBottom:14}}>
                  Muscle frequency (sessions)
                </div>
                <MuscleFrequencyChart workouts={gv}/>
              </div>
            </div>

            {/* Exercise progress — one card per exercise, click to expand chart */}
            <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20,backdropFilter:'blur(12px)'}}>
              <div style={{fontFamily:'var(--fd-mono)',fontSize:10.5,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase',marginBottom:14}}>
                Lifts · PR × reps · tap to see progress
              </div>
              <ExerciseProgressGrid workouts={gv} exercisePRs={data.exercisePRs} bodyweightLbs={data.bodyweightLbs}/>
            </div>
          </div>
        )})()}

        {/* ── 08 Training plan ── */}
        <div style={{marginTop:48}}>
          <SectionHead num="08" label="Mon → Sun" title={<>This week's <em style={{color:'rgba(255,255,255,0.45)'}}>plan.</em></>}/>
          {data.plan?<Plan plan={data.plan}/>:<div style={{color:'rgba(255,255,255,0.3)',fontFamily:'"JetBrains Mono",monospace',fontSize:11,padding:24,textAlign:'center'}}>No plan generated yet</div>}
        </div>

        {/* ── 09 Insights & feed ── */}
        <div style={{marginTop:48}}>
          <SectionHead num="09" label="Coach notes" title={<>Read & <em style={{color:'rgba(255,255,255,0.45)'}}>react.</em></>}/>

          {/* Top row: coach notes + activity feed */}
          {/* height is explicit so both columns are bounded — InsightCard fills it via height:100%,
              activities panel scrolls internally within the same bounded row */}
          <div style={{display:'grid',gap:14,gridTemplateColumns:'5fr 7fr',marginBottom:14,
                        height:'clamp(480px, 65vh, 680px)', alignItems:'stretch'}}>
            <InsightCard
              insight={data.insight}
              workouts={data.gymverse}
              exercisePRs={data.exercisePRs}
              bodyweightLbs={data.bodyweightLbs}
            />
            <div style={{
              background:'var(--fd-surface)', border:'1px solid rgba(255,255,255,0.06)',
              borderRadius:16, backdropFilter:'blur(12px)',
              display:'flex', flexDirection:'column', overflow:'hidden',
              /* height is 100% of the grid row — gives the flex column a concrete height */
              height: '100%',
            }}>
              {/* Fixed header */}
              <div style={{
                padding:'16px 20px 12px', flexShrink:0,
                display:'flex', alignItems:'center', justifyContent:'space-between',
                fontFamily:'"JetBrains Mono",monospace', fontSize:10.5,
                color:'rgba(255,255,255,0.35)', letterSpacing:'.16em', textTransform:'uppercase',
                borderBottom:'1px solid rgba(255,255,255,0.05)',
              }}>
                <span>Recent activities</span>
                <span>{data.acts.length} total</span>
              </div>
              {/* Scrollable feed — flex:1 + minHeight:0 lets it shrink and scroll */}
              <div style={{flex:1, overflowY:'auto', padding:'12px 20px 16px', minHeight:0}}>
                <Feed acts={data.acts} gymByExtId={data.gymByExtId ?? {}}/>
              </div>
            </div>
          </div>

          {/* Bottom row: run pace trend + strength snapshot */}
          <div style={{display:'grid',gap:14,gridTemplateColumns: data.gymverse?.length > 0 ? '1fr 1fr' : '1fr'}}>
            {/* Run pace trend — always visible */}
            <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20,backdropFilter:'blur(12px)'}}>
              <RunPaceTrendChart acts={data.acts}/>
            </div>

            {/* Strength snapshot */}
            {data.gymverse?.length > 0 && (
              <div style={{background:'var(--fd-surface)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20,backdropFilter:'blur(12px)'}}>
                <div style={{fontFamily:'var(--fd-mono)',fontSize:10.5,color:'var(--fd-ink3)',letterSpacing:'.14em',textTransform:'uppercase',marginBottom:16}}>
                  Strength snapshot
                </div>
                <StrengthInsightCard
                  workouts={data.gymverse}
                  exercisePRs={data.exercisePRs}
                  bodyweightLbs={data.bodyweightLbs}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{marginTop:48,paddingTop:20,borderTop:'1px solid rgba(255,255,255,0.06)',display:'flex',justifyContent:'space-between',fontFamily:'"JetBrains Mono",monospace',fontSize:10.5,color:'rgba(255,255,255,0.25)'}}>
          <span>Strava · Apple Health · GPS data via Leaflet + CARTO</span>
          <span>refreshed {today.toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}</span>
        </div>
      </div>
    </div>
  )
}
