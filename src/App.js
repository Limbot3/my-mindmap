import React, { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import ReactFlow, { 
  addEdge, 
  Background, 
  Controls, 
  applyNodeChanges, 
  applyEdgeChanges,
  Handle,         
  Position,       
  useReactFlow,   
  ReactFlowProvider,
  getNodesBounds,         // FIX EKSPOR: Untuk menghitung ukuran kanvas
  getViewportForBounds    // FIX EKSPOR: Untuk memfokuskan kamera saat difoto
} from 'reactflow';
import 'reactflow/dist/style.css';
import './App.css';

import { auth, db, signInWithGoogle, logout } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, onSnapshot } from 'firebase/firestore'; 

// IMPORT LIBRARY EKSPOR
import { toPng, toSvg } from 'html-to-image';
import { jsPDF } from 'jspdf';

const AppContext = createContext();

// ==========================================
// 1. KOMPONEN CUSTOM NODE
// ==========================================
const CustomNode = ({ id, data }) => {
  const { setNodes, setEdges, getEdges } = useReactFlow();
  const { takeSnapshot, triggerAutoSave } = useContext(AppContext);

  const handleEdit = () => {
    const newText = prompt("Edit idemu:", data.label);
    if (newText && newText.trim() !== "") {
      takeSnapshot(); 
      setNodes((nds) => {
        const newNodes = nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: newText } } : n));
        triggerAutoSave(newNodes, getEdges()); 
        return newNodes;
      });
    }
  };

  const handleDelete = () => {
    if(window.confirm("Yakin ingin menghapus ide ini?")) {
      takeSnapshot();
      setNodes((nds) => {
        const newNodes = nds.filter((n) => n.id !== id);
        setEdges((eds) => {
          const newEdges = eds.filter((e) => e.source !== id && e.target !== id);
          triggerAutoSave(newNodes, newEdges); 
          return newEdges;
        });
        return newNodes;
      });
    }
  };

  return (
    <div className="custom-node-container">
      <Handle type="target" position={Position.Top} />
      <div className="node-content">{data.label}</div>
      <div className="node-buttons">
        <button className="node-btn" onClick={handleEdit} title="Edit">✏️</button>
        <button className="node-btn" onClick={handleDelete} title="Hapus">🗑️</button>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

const nodeTypes = { customNode: CustomNode };

// ==========================================
// 2. KOMPONEN UTAMA (MIND MAP)
// ==========================================
function MindMapApp() {
  const { getNodes } = useReactFlow(); // Ambil fungsi pembaca node dari React Flow

  const [user, setUser] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  
  const [saveStatus, setSaveStatus] = useState('✅ Tersimpan');
  const searchParams = new URLSearchParams(window.location.search);
  const sharedMapId = searchParams.get('map');
  const [currentMapId, setCurrentMapId] = useState(null);
  
  const saveTimeout = useRef(null);
  const isDirtyRef = useRef(false); 

  // === MENGAMBIL DATA DARI FIREBASE (REAL-TIME) ===
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const activeMapId = sharedMapId || currentUser.uid;
        setCurrentMapId(activeMapId);

        const docRef = doc(db, "mindmaps", activeMapId);
        const unsubscribeData = onSnapshot(docRef, (docSnap) => {
          if (docSnap.exists()) {
            if (!isDirtyRef.current && !docSnap.metadata.hasPendingWrites) {
              const loadedNodes = docSnap.data().nodes || [];
              setNodes(loadedNodes.map(n => ({ ...n, type: 'customNode' })));
              setEdges(docSnap.data().edges || []);
              setPast([]);
              setFuture([]);
            }
          } else if (!sharedMapId) {
            setNodes([{ id: '1', type: 'customNode', position: { x: 250, y: 250 }, data: { label: 'Ide Utama' } }]);
          }
        });
        return () => unsubscribeData();
      }
    });
    return () => unsubscribeAuth();
  }, [sharedMapId]);

  // === FITUR AUTO-SAVE ===
  const triggerAutoSave = useCallback((newNodes, newEdges) => {
    if (!user || !currentMapId) return;
    setSaveStatus('⏳ Menyimpan...');
    isDirtyRef.current = true; 
    
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      try {
        await setDoc(doc(db, "mindmaps", currentMapId), {
          nodes: newNodes,
          edges: newEdges,
          lastUpdated: new Date()
        });
        setSaveStatus('✅ Tersimpan');
        setTimeout(() => { isDirtyRef.current = false; }, 500); 
      } catch (err) {
        console.error("Gagal menyimpan:", err);
        setSaveStatus('❌ Gagal Simpan');
        isDirtyRef.current = false;
      }
    }, 1000);
  }, [user, currentMapId]);

  // === FITUR UNDO & REDO ===
  const takeSnapshot = useCallback(() => {
    setPast((prev) => [...prev, { nodes, edges }]);
    setFuture([]); 
  }, [nodes, edges]);

  const handleUndo = () => {
    if (past.length === 0) return;
    const previousState = past[past.length - 1];
    setPast((prev) => prev.slice(0, -1));
    setFuture((prev) => [{ nodes, edges }, ...prev]); 
    setNodes(previousState.nodes);
    setEdges(previousState.edges);
    triggerAutoSave(previousState.nodes, previousState.edges);
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const nextState = future[0];
    setFuture((prev) => prev.slice(1));
    setPast((prev) => [...prev, { nodes, edges }]); 
    setNodes(nextState.nodes);
    setEdges(nextState.edges);
    triggerAutoSave(nextState.nodes, nextState.edges);
  };

  // === EVENT HANDLER REACT FLOW ===
  const addNode = () => {
    takeSnapshot();
    const newNode = {
      id: `node_${new Date().getTime()}`,
      type: 'customNode', 
      position: { x: Math.random() * 300, y: Math.random() * 300 },
      data: { label: 'Ide Baru' },
    };
    setNodes((nds) => {
      const newNodes = nds.concat(newNode);
      triggerAutoSave(newNodes, edges);
      return newNodes;
    });
  };

  const onNodeDragStart = useCallback(() => takeSnapshot(), [takeSnapshot]);
  const onNodeDragStop = useCallback((event, node, nodesArray) => triggerAutoSave(nodesArray, edges), [triggerAutoSave, edges]);
  
  const onConnect = useCallback((params) => {
    takeSnapshot();
    setEdges((eds) => {
      const newEdges = addEdge(params, eds);
      triggerAutoSave(nodes, newEdges);
      return newEdges;
    });
  }, [takeSnapshot, triggerAutoSave, nodes]);

  const onNodesChange = useCallback((changes) => {
    const safeChanges = changes.filter(c => c.type !== 'remove');
    setNodes((nds) => applyNodeChanges(safeChanges, nds));
  }, []);

  const onEdgesChange = useCallback((changes) => {
    const safeChanges = changes.filter(c => c.type !== 'remove');
    setEdges((eds) => applyEdgeChanges(safeChanges, eds));
  }, []);

  const handleInvite = () => {
    navigator.clipboard.writeText(`${window.location.origin}?map=${currentMapId}`);
    alert("🔗 Link berhasil disalin! Kirimkan ke temanmu untuk edit bersama.");
  };

  // === FITUR DOWNLOAD / EKSPOR YANG SUDAH DIPERBAIKI (Garis tidak hilang) ===
  const handleDownload = async (format) => {
    // 1. Targetkan VIEWPORT agar garis yang "keluar layar" tetap terfoto
    const element = document.querySelector('.react-flow__viewport');
    if (!element) return;

    setSaveStatus('⏳ Mengekspor...');
    
    try {
      // 2. Kalkulasi batas ujung ke ujung dari semua ide yang ada
      const currentNodes = getNodes();
      if (currentNodes.length === 0) return; // Cegah error jika kanvas kosong

      const nodesBounds = getNodesBounds(currentNodes);
      const imageWidth = nodesBounds.width + 100; // Beri ruang bernapas 100px
      const imageHeight = nodesBounds.height + 100;
      
      // 3. Atur kamera virtual untuk pemotretan
      const viewport = getViewportForBounds(nodesBounds, imageWidth, imageHeight, 0.5, 2);

      // 4. Pengaturan khusus html-to-image
      const exportOptions = {
        backgroundColor: '#f1f5f9',
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
      };

      if (format === 'png') {
        const dataUrl = await toPng(element, exportOptions);
        const link = document.createElement('a');
        link.download = 'brainstorming-map.png';
        link.href = dataUrl;
        link.click();
      } else if (format === 'svg') {
        const dataUrl = await toSvg(element, exportOptions);
        const link = document.createElement('a');
        link.download = 'brainstorming-map.svg';
        link.href = dataUrl;
        link.click();
      } else if (format === 'pdf') {
        const dataUrl = await toPng(element, exportOptions);
        const pdf = new jsPDF({
          orientation: imageWidth > imageHeight ? 'landscape' : 'portrait',
          unit: 'px',
          format: [imageWidth, imageHeight]
        });
        pdf.addImage(dataUrl, 'PNG', 0, 0, imageWidth, imageHeight);
        pdf.save('brainstorming-map.pdf');
      }
      
      setSaveStatus('✅ Berhasil diekspor!');
      setTimeout(() => setSaveStatus('✅ Tersimpan'), 2000);
    } catch (err) {
      console.error("Gagal mengekspor:", err);
      setSaveStatus('❌ Gagal Ekspor');
    }
  };

  // === HALAMAN LOGIN ===
  if (!user) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh', 
        background: 'linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%)' 
      }}>
        <div className="glass-panel" style={{ padding: '50px', textAlign: 'center', maxWidth: '400px' }}>
        <h2 style={{ margin: '0 0 10px 0', color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '15px', fontFamily: "'Lim', sans-serif" }}>
          <img src="/brei.svg" alt="Logo Brainstorm" width="80" height="80" />
          <img src="/mind.svg" alt="Tulisan Brainstorming App" height="40" />
        </h2>
          <p style={{ color: '#64748b', marginBottom: '30px' }}>Tuangkan ide brilianmu ke dalam kanvas tak terbatas.</p>
          <button className="gsi-material-button" onClick={signInWithGoogle} style={{ margin: '0 auto' }}>
            <div className="gsi-material-button-state"></div>
            <div className="gsi-material-button-content-wrapper">
              <div className="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{display: 'block'}}>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span className="gsi-material-button-contents">Sign in with Google</span>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // === KANVAS MIND MAP ===
  return (
    <AppContext.Provider value={{ takeSnapshot, triggerAutoSave }}>
      <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
        <div className="glass-panel" style={{ position: 'absolute', zIndex: 10, top: 20, left: 20, padding: '20px', minWidth: '380px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#1e293b' }}>✨ Hi, {user.displayName}</h3>
          
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <button className="btn" onClick={handleUndo} disabled={past.length === 0} style={{ opacity: past.length === 0 ? 0.5 : 1 }}>↩️ Undo</button>
            <button className="btn" onClick={handleRedo} disabled={future.length === 0} style={{ opacity: future.length === 0 ? 0.5 : 1 }}>↪️ Redo</button>
            <button className="btn btn-add" onClick={addNode}>+ Tambah Ide</button>
            <button className="btn" onClick={handleInvite} style={{ backgroundColor: '#f59e0b', color: 'white' }}>🔗 Invite</button>
            <button className="btn btn-logout" onClick={logout}>Keluar</button>
          </div>
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', paddingBottom: '10px', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#475569' }}>📥 Ekspor:</span>
            <button className="btn" onClick={() => handleDownload('png')} style={{ backgroundColor: '#8b5cf6', color: 'white', padding: '6px 10px', fontSize: '12px' }}>PNG</button>
            <button className="btn" onClick={() => handleDownload('svg')} style={{ backgroundColor: '#8b5cf6', color: 'white', padding: '6px 10px', fontSize: '12px' }}>SVG</button>
            <button className="btn" onClick={() => handleDownload('pdf')} style={{ backgroundColor: '#8b5cf6', color: 'white', padding: '6px 10px', fontSize: '12px' }}>PDF</button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: saveStatus.includes('✅') ? '#10b981' : (saveStatus.includes('❌') ? '#ef4444' : '#64748b') }}>
              {saveStatus}
            </span>
            {sharedMapId && (
              <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 'bold' }}>🤝 Mode Kolaborasi</span>
            )}
          </div>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes} 
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart} 
          onNodeDragStop={onNodeDragStop}   
          deleteKeyCode={null} 
          fitView
        >
          <Background variant="lines" color="#e2e8f0" gap={30} size={1} />
          <Controls />
        </ReactFlow>
      </div>
    </AppContext.Provider>
  );
}

// 3. BUNGKUS APLIKASI
export default function App() {
  return (
    <ReactFlowProvider>
      <MindMapApp />
    </ReactFlowProvider>
  );
}