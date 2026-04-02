/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, Component, useRef } from 'react';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  addDoc, 
  deleteDoc,
  query, 
  orderBy, 
  getDoc,
  getDocs,
  serverTimestamp,
  increment,
  runTransaction,
  getDocFromServer,
  where,
  limit
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { db, auth } from './firebase';
import { 
  ChefHat, 
  Trophy, 
  Users, 
  LogOut, 
  RefreshCw, 
  Plus, 
  History, 
  Dice5,
  ListOrdered,
  ArrowUp,
  ArrowDown,
  Zap,
  AlertCircle,
  GripVertical,
  BarChart3,
  Info,
  Search,
  FileText,
  MessageSquare,
  Camera,
  X,
  Target,
  CheckCircle2,
  Table as TableIcon,
  Send,
  Lock,
  ArrowRight,
  Shield,
  ShieldCheck,
  PieChart,
  ChevronRight,
  Globe,
  Link
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

class ErrorBoundary extends Component<any, any> {
  constructor(props: any) {
    super(props);
    // @ts-ignore
    this.state = { hasError: false, errorInfo: '' };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    // @ts-ignore
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-red-100">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertCircle className="w-8 h-8" />
              <h2 className="text-xl font-bold">Something went wrong</h2>
            </div>
            <p className="text-stone-600 mb-6">The application encountered an error. Please try refreshing the page.</p>
            <div className="bg-stone-50 p-4 rounded-lg overflow-auto max-h-40 mb-6">
              {/* @ts-ignore */}
              <code className="text-xs text-red-500">{this.state.errorInfo}</code>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-stone-900 text-white py-3 rounded-xl font-bold hover:bg-stone-800 transition-all"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    // @ts-ignore
    return this.props.children;
  }
}

// --- Types ---

interface Chef {
  id: string;
  name: string;
  hometown: string;
  status: 'active' | 'eliminated' | 'lck';
  totalScore: number;
  imageUrl?: string;
}

interface Player {
  id: string;
  name: string;
  displayName?: string;
  draftOrder: number;
  chefIds: string[];
  totalScore: number;
  email?: string;
  prefilledEmail?: string;
  photoURL?: string;
  rankings?: string[]; // Array of chef IDs in order of preference
}

interface ScoreEvent {
  id: string;
  chefId: string;
  week: number;
  type: string;
  points: number;
  description: string;
  timestamp: any;
}

interface LeagueConfig {
  draftStarted: boolean;
  draftCompleted: boolean;
  currentDraftTurn: number;
  draftOrder: string[]; // Array of player IDs
  rankingsOpen: boolean;
  rankingWeight?: number; // 0 to 1, default 0.5
  inviteCode?: string;
}

// --- Constants ---

const SCORING_RULES = [
  { type: 'Quickfire Win', points: 5 },
  { type: 'Quickfire Favorite', points: 2 },
  { type: 'Quickfire Least Favorite', points: -1 },
  { type: 'Elimination Win', points: 7 },
  { type: 'Episode Sweep Bonus', points: 3 },
  { type: 'Judges Table Top', points: 4 },
  { type: 'Judges Table Bottom', points: -2 },
  { type: 'Last Chance Kitchen Win', points: 2 },
  { type: 'Making Season Finale', points: 15 },
  { type: 'Winning Top Chef', points: 30 },
  { type: 'Eliminated', points: -2 },
];

const INITIAL_PLAYERS = [
  'Garrett', 'Anna', 'Chris', 'Chelsea', 'Shane', 'Travis', 'Lori'
];

// --- Components ---

function PollWidget({ poll, user }: { poll: Poll | null, user: User | null }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newOptions, setNewOptions] = useState(['', '']);
  const [showAdmin, setShowAdmin] = useState(false);

  // Check if current user has voted
  const hasVoted = user && poll?.votes?.[user.uid] !== undefined;
  const userVote = user ? poll?.votes?.[user.uid] : undefined;

  const handleVote = async (optionIndex: number) => {
    if (!poll || !user || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const pollRef = doc(db, 'polls', poll.id);
      await updateDoc(pollRef, {
        [`votes.${user.uid}`]: optionIndex
      });
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `polls/${poll.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreatePoll = async () => {
    if (!user || isSubmitting || !newQuestion.trim() || newOptions.some(o => !o.trim())) return;
    setIsSubmitting(true);
    try {
      // Close existing poll if any
      if (poll) {
        await updateDoc(doc(db, 'polls', poll.id), { active: false });
      }
      await addDoc(collection(db, 'polls'), {
        question: newQuestion.trim(),
        options: newOptions.map(o => o.trim()),
        votes: {},
        active: true,
        createdAt: new Date().toISOString()
      });
      setNewQuestion('');
      setNewOptions(['', '']);
      setShowAdmin(false);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'polls');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClosePoll = async () => {
    if (!user || !poll || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'polls', poll.id), { active: false });
      setShowAdmin(false);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `polls/${poll.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalVotes = poll ? Object.keys(poll.votes || {}).length : 0;

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-black tracking-tight flex items-center gap-2 text-stone-900">
          <PieChart className="w-5 h-5 text-orange-500" />
          Weekly Poll
        </h2>
        {user && (
          <button 
            onClick={() => setShowAdmin(!showAdmin)}
            className="text-[10px] font-bold uppercase tracking-wider text-stone-400 hover:text-stone-600 transition-colors"
          >
            {showAdmin ? 'Cancel' : 'New Poll'}
          </button>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        {showAdmin ? (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
            <h3 className="text-sm font-bold text-stone-900 uppercase tracking-wider">Create New Poll</h3>
            <div className="space-y-3">
              <input 
                type="text" 
                placeholder="New Poll Question" 
                value={newQuestion}
                onChange={e => setNewQuestion(e.target.value)}
                className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
              />
              {newOptions.map((opt, i) => (
                <input 
                  key={i}
                  type="text" 
                  placeholder={`Option ${i + 1}`} 
                  value={opt}
                  onChange={e => {
                    const newOpts = [...newOptions];
                    newOpts[i] = e.target.value;
                    setNewOptions(newOpts);
                  }}
                  className="w-full p-3 rounded-xl border border-stone-200 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
                />
              ))}
              <button 
                onClick={() => setNewOptions([...newOptions, ''])}
                className="text-xs font-bold text-orange-600 uppercase tracking-wider hover:text-orange-700 transition-colors"
              >
                + Add Option
              </button>
              
              <div className="pt-4 space-y-2">
                <button 
                  onClick={handleCreatePoll}
                  disabled={isSubmitting || !newQuestion.trim() || newOptions.some(o => !o.trim())}
                  className="w-full bg-orange-600 text-white p-3 rounded-xl text-sm font-bold hover:bg-orange-700 transition-colors disabled:opacity-50"
                >
                  Publish Poll
                </button>
                {poll && (
                  <button 
                    onClick={handleClosePoll}
                    disabled={isSubmitting}
                    className="w-full bg-stone-100 text-stone-600 p-3 rounded-xl text-sm font-bold hover:bg-stone-200 transition-colors"
                  >
                    Close Current Poll
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : poll ? (
          <div className="space-y-6 flex-1 flex flex-col">
            <h3 className="text-xl font-bold text-stone-900 leading-tight">{poll.question}</h3>
            
            <div className="space-y-3 flex-1">
              {poll.options.map((option, index) => {
                const votesForOption = Object.values(poll.votes || {}).filter(v => v === index).length;
                const percentage = totalVotes > 0 ? Math.round((votesForOption / totalVotes) * 100) : 0;
                const isSelected = userVote === index;

                return (
                  <div key={index} className="relative">
                    <button
                      onClick={() => handleVote(index)}
                      disabled={hasVoted || !user || isSubmitting}
                      className={`w-full relative overflow-hidden rounded-xl border p-4 text-left transition-all ${
                        isSelected 
                          ? 'border-orange-500 bg-orange-50' 
                          : hasVoted 
                            ? 'border-stone-200 bg-white' 
                            : 'border-stone-200 bg-white hover:border-orange-300 hover:bg-stone-50'
                      }`}
                    >
                      {hasVoted && (
                        <div 
                          className={`absolute inset-y-0 left-0 opacity-10 ${isSelected ? 'bg-orange-500' : 'bg-stone-500'}`}
                          style={{ width: `${percentage}%`, transition: 'width 1s ease-out' }}
                        />
                      )}
                      <div className="relative flex items-center justify-between gap-4 z-10">
                        <span className={`font-medium ${isSelected ? 'text-orange-900 font-bold' : 'text-stone-700'}`}>
                          {option}
                        </span>
                        {hasVoted && (
                          <span className="text-sm font-bold text-stone-500">
                            {percentage}%
                          </span>
                        )}
                      </div>
                    </button>
                    {isSelected && (
                      <div className="absolute -right-2 -top-2 bg-white rounded-full">
                        <CheckCircle2 className="w-6 h-6 text-orange-500" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            <div className="text-center text-xs font-bold uppercase tracking-widest text-stone-400 pt-4">
              {totalVotes} {totalVotes === 1 ? 'Vote' : 'Votes'}
            </div>

            {!user && (
              <div className="p-4 bg-stone-100 rounded-xl text-center text-sm text-stone-500 mt-4">
                Please login to vote.
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-stone-400 py-12 flex-1 flex flex-col justify-center">
            <PieChart className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">No active poll right now.</p>
            {user && (
              <button 
                onClick={() => setShowAdmin(true)}
                className="mt-4 text-xs font-bold uppercase tracking-wider text-orange-600 hover:text-orange-700 transition-colors"
              >
                Create One
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [chefs, setChefs] = useState<Chef[]>([]);
  const [rawPlayers, setRawPlayers] = useState<Player[]>([]);
  const [comments, setComments] = useState<PlayerStatus[]>([]);
  const [activePoll, setActivePoll] = useState<Poll | null>(null);
  const [maxWeek, setMaxWeek] = useState<number>(0);

  useEffect(() => {
    const fetchMaxWeek = async () => {
      try {
        const q = query(collection(db, 'scoreEvents'), orderBy('week', 'desc'), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          setMaxWeek(snap.docs[0].data().week);
        }
      } catch (error) {
        console.error("Error fetching max week:", error);
      }
    };
    fetchMaxWeek();
  }, []);

  const players = useMemo(() => {
    return rawPlayers.map(player => {
      const calculatedScore = player.chefIds.reduce((sum, chefId) => {
        const chef = chefs.find(c => c.id === chefId);
        return sum + (chef ? chef.totalScore : 0);
      }, 0);
      return { ...player, totalScore: calculatedScore };
    });
  }, [rawPlayers, chefs]);

  useEffect(() => {
    const q = query(collection(db, 'polls'), where('active', '==', true), limit(1));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setActivePoll({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Poll);
      } else {
        setActivePoll(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'polls');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'playerStatuses'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PlayerStatus)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'playerStatuses');
    });
    return () => unsubscribe();
  }, []);
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  const [activeTab, setActiveTab] = useState<'scoreboard' | 'rankings' | 'draft' | 'stats' | 'scoring' | 'admin'>('scoreboard');
  const [claimId, setClaimId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);
  const [proxyPlayerId, setProxyPlayerId] = useState('');

  const showStatus = (type: 'success' | 'error' | 'info', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const isAdmin = user?.email?.toLowerCase() === 'garrettlmiller@gmail.com';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const claim = params.get('claim');
    if (claim) {
      setClaimId(claim);
      // Remove the parameter from URL without refreshing
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    if (user) {
      console.log('Logged in as:', user.email);
      console.log('Is Admin:', isAdmin);
    }
  }, [user, isAdmin]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(false);
      
      if (u) {
        // Update player photoURL if they are in the league
        const playerRef = doc(db, 'players', u.uid);
        const playerSnap = await getDoc(playerRef);
        if (playerSnap.exists()) {
          await updateDoc(playerRef, {
            photoURL: u.photoURL || null
          });
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubChefs = onSnapshot(collection(db, 'chefs'), (snapshot) => {
      setChefs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Chef)));
    });
    const unsubPlayers = onSnapshot(collection(db, 'players'), (snapshot) => {
      setRawPlayers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Player)));
    });
    const unsubConfig = onSnapshot(doc(db, 'config', 'league'), (snapshot) => {
      if (snapshot.exists()) {
        setConfig(snapshot.data() as LeagueConfig);
      }
    });

    return () => {
      unsubChefs();
      unsubPlayers();
      unsubConfig();
    };
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => signOut(auth);

  const seedData = async () => {
    if (!isAdmin || !auth.currentUser) {
      showStatus('error', "You must be logged in as an admin to seed data.");
      return;
    }

    setLoading(true);
    try {
      console.log('Starting seed process...');

      // 0. Clear existing data
      const collectionsToClear = ['chefs', 'players', 'scoreEvents'];
      for (const collName of collectionsToClear) {
        const snap = await getDocs(collection(db, collName));
        const deletePromises = snap.docs.map(d => deleteDoc(d.ref));
        await Promise.all(deletePromises);
      }
      console.log('Existing data cleared.');
      
      // 1. Seed Chefs
      const initialChefs = [
        { name: 'Sieger Bayer', hometown: 'Chicago, Illinois' },
        { name: 'Jaspratap "Jassi" Bindra', hometown: 'Houston, Texas' },
        { name: 'Sherry Cardoso', hometown: 'Brooklyn, New York' },
        { name: 'Brittany Cochran', hometown: 'Charlotte, North Carolina' },
        { name: 'Oscar Diaz', hometown: 'Durham, North Carolina' },
        { name: 'Brandon Dearden', hometown: 'Hamilton, Montana' },
        { name: 'Jonathan Dearden', hometown: 'Alexandria, Virginia' },
        { name: 'Duyen Ha', hometown: 'Los Angeles, California' },
        { name: 'Jennifer Lee Jackson', hometown: 'Suttons Bay, Michigan' },
        { name: 'Anthony Jones', hometown: 'Alexandria, Virginia' },
        { name: 'Day Anaïs Joseph', hometown: 'Atlanta, Georgia', status: 'eliminated' },
        { name: 'Laurence Louie', hometown: 'Quincy, Massachusetts' },
        { name: 'Rhoda Magbitang', hometown: 'Kailua-Kona, Hawaii' },
        { name: 'Justin Tootla', hometown: 'Suttons Bay, Michigan' },
        { name: 'Nana Araba Wilmot', hometown: 'Cherry Hill, New Jersey' }
      ];

      const chefPromises = initialChefs.map(chef => 
        addDoc(collection(db, 'chefs'), {
          name: chef.name,
          hometown: chef.hometown,
          status: chef.status || 'active',
          totalScore: 0
        }).catch(err => {
          throw new Error(JSON.stringify(handleFirestoreError(err, OperationType.CREATE, 'chefs')));
        })
      );
      await Promise.all(chefPromises);
      console.log('Chefs seeded.');

      // 2. Seed Players
      const shuffledPlayers = [...INITIAL_PLAYERS].sort(() => Math.random() - 0.5);
      const playerIds: string[] = [];

      for (const name of shuffledPlayers) {
        try {
          // If the name is "Garrett" and the current user is the admin, use their UID
          const isMe = name === 'Garrett' && auth.currentUser?.email?.toLowerCase() === 'garrettlmiller@gmail.com';
          const docId = isMe ? auth.currentUser!.uid : undefined;
          
          const playerRef = docId ? doc(db, 'players', docId) : doc(collection(db, 'players'));
          
          await setDoc(playerRef, {
            name,
            draftOrder: playerIds.length,
            chefIds: [],
            totalScore: 0,
            email: isMe ? auth.currentUser!.email : null
          });
          playerIds.push(playerRef.id);
        } catch (err) {
          throw new Error(JSON.stringify(handleFirestoreError(err, OperationType.CREATE, 'players')));
        }
      }
      console.log('Players seeded.');

      // 3. Seed Config
      try {
        await setDoc(doc(db, 'config', 'league'), {
          draftStarted: false,
          draftCompleted: false,
          currentDraftTurn: 0,
          draftOrder: playerIds,
          rankingsOpen: true
        });
      } catch (err) {
        throw new Error(JSON.stringify(handleFirestoreError(err, OperationType.WRITE, 'config/league')));
      }
      
      console.log('Config seeded. Success!');
      showStatus('success', 'League seeded successfully!');
    } catch (error: any) {
      console.error('Seed failed:', error);
      showStatus('error', 'Seeding failed. Check console.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinLeague = async () => {
    if (!user || !config) return;

    if (config.inviteCode) {
      const code = prompt('Please enter the League Invite Code to join:');
      if (!code || code !== config.inviteCode) {
        showStatus('error', 'Invalid invite code. Please ask the league administrator for the correct code.');
        return;
      }
    }

    try {
      // Check if there's a player with the same name but no UID
      // Try exact match first, then first name match
      const googleName = user.displayName || '';
      const firstName = googleName.split(' ')[0];
      
      // Prioritize claimId from URL if present
      let existingPlayer = claimId ? players.find(p => p.id === claimId && !p.email) : null;
      
      // Fallback to name matching if no claimId or claimId invalid
      if (!existingPlayer) {
        existingPlayer = players.find(p => 
          !p.email && (
            (p.prefilledEmail && p.prefilledEmail.toLowerCase() === user.email?.toLowerCase()) ||
            p.name.toLowerCase() === googleName.toLowerCase() || 
            p.name.toLowerCase() === firstName.toLowerCase()
          )
        );
      }
      
      if (existingPlayer) {
        // Claim existing profile
        const newPlayerRef = doc(db, 'players', user.uid);
        await setDoc(newPlayerRef, {
          ...existingPlayer,
          id: user.uid,
          email: user.email,
          name: googleName // Update to full name from Google
        });
        
        // Update draft order in config to point to the new ID
        const newDraftOrder = config.draftOrder.map(id => id === existingPlayer.id ? user.uid : id);
        await updateDoc(doc(db, 'config', 'league'), {
          draftOrder: newDraftOrder
        });

        await deleteDoc(doc(db, 'players', existingPlayer.id));
        setClaimId(null); // Clear claimId after successful join
      } else {
        // Create new profile
        const newPlayerRef = doc(db, 'players', user.uid);
        await setDoc(newPlayerRef, {
          name: googleName || 'Player',
          email: user.email,
          draftOrder: players.length,
          chefIds: [],
          totalScore: 0
        });
        
        // Add to draft order if not already there
        if (!config.draftOrder.includes(user.uid)) {
          await updateDoc(doc(db, 'config', 'league'), {
            draftOrder: [...config.draftOrder, user.uid]
          });
        }
      }
      showStatus('success', 'Joined league successfully!');
    } catch (error) {
      console.error('Join failed:', error);
      showStatus('error', 'Failed to join league.');
    }
  };

  const handleAutoDraft = async () => {
    if (!config || config.draftCompleted || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const availableChefs = chefs.filter(c => !players.some(p => p.chefIds.includes(c.id)) && c.status === 'active');
      
      const turnIndex = config.currentDraftTurn;
      const round = Math.floor(turnIndex / players.length);
      const indexInRound = turnIndex % players.length;
      const playerIndex = round % 2 === 0 ? indexInRound : (players.length - 1 - indexInRound);
      const playerId = config.draftOrder[playerIndex];
      const player = players.find(p => p.id === playerId);

      if (!player) throw new Error("Player not found");

      let chefToPickId: string;
      
      // Try to pick from rankings
      const rankedAvailable = (player.rankings || []).find(id => availableChefs.some(c => c.id === id));
      
      if (rankedAvailable) {
        chefToPickId = rankedAvailable;
      } else {
        // Pick first available if no rankings match
        chefToPickId = availableChefs[0].id;
      }

      await runTransaction(db, async (transaction) => {
        const playerRef = doc(db, 'players', player.id);
        const configRef = doc(db, 'config', 'league');
        
        const playerSnap = await transaction.get(playerRef);
        const configSnap = await transaction.get(configRef);
        
        if (!playerSnap.exists() || !configSnap.exists()) throw new Error("Missing docs");

        const currentChefIds = playerSnap.data().chefIds || [];
        transaction.update(playerRef, { chefIds: [...currentChefIds, chefToPickId] });

        const nextTurn = turnIndex + 1;
        transaction.update(configRef, {
          currentDraftTurn: nextTurn,
          draftCompleted: nextTurn >= (players.length * 2)
        });
      });
    } catch (error) {
      console.error(error);
      showStatus('error', 'Auto-draft failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFullAutoDraft = async () => {
    if (!config || config.draftCompleted || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await runTransaction(db, async (transaction) => {
        const configRef = doc(db, 'config', 'league');
        const configSnap = await transaction.get(configRef);
        if (!configSnap.exists()) throw new Error("Config not found");
        
        const currentConfig = configSnap.data() as LeagueConfig;
        let turnIndex = currentConfig.currentDraftTurn;
        const totalPicks = players.length * 2;
        
        // Load all players into a local map for simulation
        const playerDocs: { [id: string]: any } = {};
        for (const p of players) {
          const pSnap = await transaction.get(doc(db, 'players', p.id));
          if (pSnap.exists()) {
            playerDocs[p.id] = { ...pSnap.data(), id: p.id };
          }
        }

        // Track available chefs
        let availableChefIds = chefs
          .filter(c => c.status === 'active' && !Object.values(playerDocs).some((p: any) => p.chefIds.includes(c.id)))
          .map(c => c.id);

        while (turnIndex < totalPicks && availableChefIds.length > 0) {
          const round = Math.floor(turnIndex / players.length);
          const indexInRound = turnIndex % players.length;
          const playerIndex = round % 2 === 0 ? indexInRound : (players.length - 1 - indexInRound);
          const playerId = currentConfig.draftOrder[playerIndex];
          const player = playerDocs[playerId];

          if (!player) break;

          let chefToPickId: string | undefined;
          
          // Try to pick from rankings
          chefToPickId = (player.rankings || []).find((id: string) => availableChefIds.includes(id));
          
          if (!chefToPickId) {
            // Pick first available if no rankings match
            chefToPickId = availableChefIds[0];
          }

          if (chefToPickId) {
            player.chefIds = [...(player.chefIds || []), chefToPickId];
            availableChefIds = availableChefIds.filter(id => id !== chefToPickId);
          }
          
          turnIndex++;
        }

        // Update all players
        for (const pId in playerDocs) {
          transaction.update(doc(db, 'players', pId), { chefIds: playerDocs[pId].chefIds });
        }

        // Update config
        transaction.update(configRef, {
          currentDraftTurn: turnIndex,
          draftCompleted: true,
          draftStarted: true
        });
      });
      showStatus('success', 'Full auto-draft completed!');
    } catch (error) {
      console.error(error);
      showStatus('error', 'Full auto-draft failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  if (!user) {
    return <LandingPage onLogin={handleLogin} />;
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-stone-100 text-stone-900 font-sans pb-20 sm:pb-0">
      {status && (
        <div className={`fixed top-4 sm:top-auto sm:bottom-24 left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-2rem)] sm:w-auto px-4 sm:px-6 py-2 sm:py-3 rounded-xl sm:rounded-2xl shadow-xl border flex items-center gap-2 sm:gap-3 animate-in fade-in slide-in-from-top-4 sm:slide-in-from-bottom-4 duration-300 ${
          status.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
          status.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
          'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          {status.type === 'success' && <Trophy className="w-4 h-4 sm:w-5 sm:h-5" />}
          {status.type === 'error' && <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5" />}
          {status.type === 'info' && <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />}
          <span className="font-bold text-xs sm:text-sm">{status.message}</span>
          <button onClick={() => setStatus(null)} className="ml-auto sm:ml-2 opacity-50 hover:opacity-100 p-1">×</button>
        </div>
      )}
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-50 pt-safe shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-20 sm:h-24 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="bg-orange-50 p-2 sm:p-3 rounded-xl sm:rounded-2xl">
              <ChefHat className="w-6 h-6 sm:w-8 sm:h-8 text-orange-600" />
            </div>
            <h1 className="text-lg sm:text-2xl md:text-3xl font-black tracking-tighter whitespace-nowrap overflow-visible text-stone-900">
              Fantasy Top Chef
            </h1>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            {user ? (
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden md:block text-right">
                  <div className="text-sm font-bold text-stone-900">{user.displayName}</div>
                  <div className="text-xs text-stone-400">{user.email}</div>
                </div>
                <img src={user.photoURL || ''} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-stone-200" alt="" />
                <button onClick={handleLogout} className="p-2 hover:bg-stone-100 rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
                  <LogOut className="w-5 h-5 sm:w-6 sm:h-6 text-stone-500" />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="bg-stone-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors min-h-[44px]"
              >
                Login
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 sm:py-6">
        {/* Desktop Navigation */}
        <div className="hidden sm:flex gap-1 bg-stone-200/50 p-1 rounded-xl mb-6 w-fit">
          <NavButton active={activeTab === 'scoreboard'} onClick={() => setActiveTab('scoreboard')} icon={<Trophy className="w-4 h-4" />} label="Scoreboard" />
          {user && (
            <NavButton 
              active={activeTab === 'rankings'} 
              onClick={() => setActiveTab('rankings')} 
              icon={
                <div className="relative">
                  <ListOrdered className="w-4 h-4" />
                  {!config?.rankingsOpen && <Lock className="w-2 h-2 absolute -top-1 -right-1 text-orange-500" />}
                </div>
              } 
              label="My Rankings" 
            />
          )}
          <NavButton active={activeTab === 'draft'} onClick={() => setActiveTab('draft')} icon={<Users className="w-4 h-4" />} label="Draft" />
          <NavButton active={activeTab === 'stats'} onClick={() => setActiveTab('stats')} icon={<BarChart3 className="w-4 h-4" />} label="Stats" />
          <NavButton active={activeTab === 'scoring'} onClick={() => setActiveTab('scoring')} icon={<Info className="w-4 h-4" />} label="Scoring" />
          {isAdmin && <NavButton active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} icon={<ShieldCheck className="w-4 h-4" />} label="Admin" />}
        </div>

        {/* Mobile Navigation (Bottom Bar) */}
        <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 z-50 pb-safe">
          <div className="flex justify-around items-center h-16">
            <MobileNavButton active={activeTab === 'scoreboard'} onClick={() => setActiveTab('scoreboard')} icon={<Trophy className="w-6 h-6" />} label="Scores" />
            {user && (
              <MobileNavButton 
                active={activeTab === 'rankings'} 
                onClick={() => setActiveTab('rankings')} 
                icon={
                  <div className="relative">
                    <ListOrdered className="w-6 h-6" />
                    {!config?.rankingsOpen && <Lock className="w-3 h-3 absolute -top-1 -right-1 text-orange-500" />}
                  </div>
                } 
                label="Rank" 
              />
            )}
            <MobileNavButton active={activeTab === 'draft'} onClick={() => setActiveTab('draft')} icon={<Users className="w-6 h-6" />} label="Draft" />
            <MobileNavButton active={activeTab === 'stats'} onClick={() => setActiveTab('stats')} icon={<BarChart3 className="w-6 h-6" />} label="Stats" />
            <MobileNavButton active={activeTab === 'scoring'} onClick={() => setActiveTab('scoring')} icon={<Info className="w-6 h-6" />} label="Rules" />
            {isAdmin && <MobileNavButton active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} icon={<ShieldCheck className="w-6 h-6" />} label="Admin" />}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'scoreboard' && (
            <motion.div 
              key="scoreboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ScoreboardView 
                players={players} 
                chefs={chefs} 
                config={config} 
                user={user} 
                comments={comments}
                onJoin={handleJoinLeague} 
                claimId={claimId}
                activePoll={activePoll}
                showStatus={showStatus}
                maxWeek={maxWeek}
              />
            </motion.div>
          )}

          {activeTab === 'rankings' && user && (
            <motion.div 
              key="rankings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <RankingView chefs={chefs} player={players.find(p => p.id === user.uid)} players={players} config={config} />
            </motion.div>
          )}

          {activeTab === 'draft' && (
            <motion.div 
              key="draft"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <DraftView 
                config={config} 
                players={players} 
                chefs={chefs} 
                isAdmin={isAdmin} 
                onAutoDraft={handleAutoDraft}
                onFullAutoDraft={handleFullAutoDraft}
                isSubmitting={isSubmitting}
                showStatus={showStatus}
              />
            </motion.div>
          )}

          {activeTab === 'stats' && (
            <motion.div 
              key="stats"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <StatsView chefs={chefs} players={players} config={config} />
            </motion.div>
          )}

          {activeTab === 'scoring' && (
            <motion.div 
              key="scoring"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ScoringView />
            </motion.div>
          )}

          {activeTab === 'admin' && isAdmin && (
            <motion.div 
              key="admin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <AdminView 
                chefs={chefs} 
                players={players} 
                seedData={seedData} 
                config={config} 
                onAutoDraft={handleAutoDraft}
                onFullAutoDraft={handleFullAutoDraft}
                isSubmittingApp={isSubmitting}
                proxyPlayerId={proxyPlayerId}
                setProxyPlayerId={setProxyPlayerId}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      </div>
    </ErrorBoundary>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all min-h-[40px] ${
        active ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MobileNavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all ${
        active ? 'text-orange-600' : 'text-stone-400'
      }`}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}

// --- Views ---

interface Poll {
  id: string;
  question: string;
  options: string[];
  votes: Record<string, number>; // userId -> optionIndex
  active: boolean;
  createdAt: string;
}

interface PlayerStatus {
  id: string;
  playerId: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: any;
}

function KitchenConfessional({ playerId, user, comments }: { playerId: string, user: User | null, comments: PlayerStatus[] }) {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const playerStatuses = comments.filter(c => c.playerId === playerId).sort((a, b) => b.timestamp?.toMillis() - a.timestamp?.toMillis());
  const myStatus = playerStatuses.find(c => c.userId === user?.uid);

  useEffect(() => {
    if (myStatus) setText(myStatus.text);
  }, [myStatus]);

  const handleSubmit = async () => {
    if (!user || !text.trim()) return;
    setIsSubmitting(true);
    try {
      if (myStatus) {
        await updateDoc(doc(db, 'playerStatuses', myStatus.id), {
          text: text.trim(),
          timestamp: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'playerStatuses'), {
          playerId,
          userId: user.uid,
          userName: user.displayName || 'Anonymous',
          text: text.trim(),
          timestamp: serverTimestamp()
        });
      }
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving thought:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isOwner = user && user.uid === playerId;

  if (!user && playerStatuses.length === 0) return null;

  return (
    <div className="flex-1 min-w-0">
      {isOwner && (isEditing || !myStatus) ? (
        <div className="flex items-center gap-2">
          <textarea 
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Confessional..."
            className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-[10px] focus:ring-1 focus:ring-orange-500 outline-none resize-none min-h-[40px]"
            autoFocus
            rows={2}
          />
          <div className="flex flex-col gap-1">
            <button 
              onClick={handleSubmit}
              disabled={isSubmitting || (myStatus?.text === text)}
              className="shrink-0 px-2 py-1 rounded-lg text-[9px] font-bold transition-all disabled:opacity-50 bg-stone-900 text-white hover:bg-stone-800"
            >
              {isSubmitting ? '...' : 'Save'}
            </button>
            {myStatus && (
              <button 
                onClick={() => setIsEditing(false)}
                className="shrink-0 px-2 py-1 rounded-lg text-[9px] font-bold bg-stone-100 text-stone-500 hover:bg-stone-200 transition-all"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : playerStatuses.length > 0 ? (
        <div 
          onClick={() => isOwner && setIsEditing(true)}
          className={`group flex items-start gap-1.5 text-[10px] italic px-2 py-1.5 rounded-lg border transition-all ${
            isOwner 
              ? 'cursor-pointer hover:border-orange-200 hover:bg-orange-50/30 bg-stone-50/30 border-stone-100/50 text-stone-600' 
              : 'bg-stone-50/30 border-stone-100/50 text-stone-500'
          } relative`}
        >
          <div className="absolute -top-1 -left-1">
            <div className="w-2 h-2 bg-stone-100 border border-stone-200 rounded-full" />
          </div>
          <MessageSquare className={`w-3 h-3 shrink-0 mt-0.5 ${isOwner ? 'text-orange-400 group-hover:text-orange-500' : 'text-stone-300'}`} />
          <p className="whitespace-normal break-words leading-relaxed">"{playerStatuses[0].text}"</p>
        </div>
      ) : isOwner ? (
        <button 
          onClick={() => setIsEditing(true)}
          className="flex items-center gap-1.5 text-[10px] font-bold text-stone-400 hover:text-orange-500 transition-colors px-2 py-1"
        >
          <MessageSquare className="w-3 h-3" />
          <span>Add Confessional...</span>
        </button>
      ) : null}
    </div>
  );
}

function ProfileModal({ player, onClose, showStatus }: { player: Player, onClose: () => void, showStatus: (type: 'success' | 'error' | 'info', message: string) => void }) {
  const [displayName, setDisplayName] = useState(player.displayName || player.name);
  const [photoURL, setPhotoURL] = useState(player.photoURL || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Limit file size to 5MB before processing
    if (file.size > 5 * 1024 * 1024) {
      showStatus('error', "Image is too large. Please select an image smaller than 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.onload = () => {
        // Create a canvas to resize the image
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Max dimensions for profile picture
        const MAX_DIM = 400;
        if (width > height) {
          if (width > MAX_DIM) {
            height *= MAX_DIM / width;
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width *= MAX_DIM / height;
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          // Compress to JPEG with 0.7 quality
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
          
          // Final check: Firestore limit is 1MB, but we want to stay well below that
          // as the document contains other data too.
          if (compressedDataUrl.length > 800000) {
            showStatus('error', "Even after compression, this image is too large. Please try a smaller image.");
            return;
          }
          
          setPhotoURL(compressedDataUrl);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'players', player.id), {
        displayName: displayName.trim(),
        photoURL: photoURL
      });
      onClose();
    } catch (error: any) {
      console.error('Error updating profile:', error);
      if (error.message?.includes('exceeds the maximum allowed size')) {
        showStatus('error', "The profile image is too large for the database. Please try a smaller or lower-resolution image.");
      } else {
        showStatus('error', "Failed to update profile. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
      >
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black text-stone-900 tracking-tight">Edit Profile</h2>
            <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-xl transition-colors">
              <X className="w-5 h-5 text-stone-400" />
            </button>
          </div>

          <div className="flex flex-col items-center gap-4">
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="relative w-24 h-24 rounded-3xl bg-stone-100 overflow-hidden border-2 border-dashed border-stone-200 cursor-pointer group"
            >
              {photoURL ? (
                <img src={photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Camera className="w-8 h-8 text-stone-300 group-hover:text-orange-500 transition-colors" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-[10px] font-bold text-white uppercase tracking-widest">Change</span>
              </div>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              accept="image/*" 
              className="hidden" 
            />
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">Tap to change photo</p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest ml-1">Fantasy Display Name</label>
            <input 
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your league name..."
              className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button 
              onClick={onClose}
              className="flex-1 px-6 py-3 rounded-2xl text-sm font-bold text-stone-600 hover:bg-stone-50 transition-all"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              disabled={isSubmitting}
              className="flex-1 bg-stone-900 text-white px-6 py-3 rounded-2xl text-sm font-bold hover:bg-stone-800 transition-all shadow-lg shadow-stone-200 disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function LandingPage({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="min-h-screen bg-stone-100 flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-4xl mx-auto">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <div className="w-24 h-24 bg-orange-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-orange-200 mb-6 rotate-3">
            <ChefHat className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-5xl sm:text-7xl font-black text-stone-900 tracking-tighter mb-4">
            FANTASY <br />
            <span className="text-orange-600 italic">TOP CHEF</span>
          </h1>
          <p className="text-stone-500 text-lg sm:text-xl font-medium max-w-md mx-auto leading-relaxed">
            The ultimate league for Top Chef fans. Draft your team, rank your favorites, and dominate the leaderboard.
          </p>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="w-full max-w-sm space-y-4"
        >
          <button 
            onClick={onLogin}
            className="w-full bg-stone-900 text-white p-5 rounded-2xl font-black text-lg flex items-center justify-center gap-3 hover:bg-stone-800 transition-all shadow-xl hover:shadow-stone-200 group"
          >
            LOGIN WITH GOOGLE
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>

          <div className="flex items-center justify-center gap-2 text-stone-400">
            <Shield className="w-3.5 h-3.5" />
            <p className="text-[10px] font-bold uppercase tracking-wider">
              Secure Login • No Passwords Stored
            </p>
          </div>
          
          <div className="pt-4 px-6">
            <p className="text-[9px] text-stone-400 leading-relaxed italic">
              We only receive your basic profile info (name/email). We never have access to your Google password or private data.
            </p>
          </div>
          
          <div className="grid grid-cols-3 gap-4 pt-8">
            <div className="text-center">
              <div className="text-xl font-black text-stone-900">15</div>
              <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Chefs</div>
            </div>
            <div className="text-center border-x border-stone-200">
              <div className="text-xl font-black text-stone-900">14</div>
              <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Weeks</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-black text-stone-900">1</div>
              <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Winner</div>
            </div>
          </div>
        </motion.div>
      </main>

      <footer className="p-8 text-center text-stone-400 text-[10px] font-bold uppercase tracking-[0.2em]">
        Fantasy Top Chef Carolinas Edition &copy; 2026
      </footer>
    </div>
  );
}

function ProgressTable({ chefs }: { chefs: Chef[] }) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const q = query(collection(db, 'scoreEvents'), orderBy('week', 'asc'));
        const snap = await getDocs(q);
        setEvents(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Error fetching score events:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-stone-500 font-medium">Loading progress data...</div>;
  }

  if (events.length === 0) {
    return <div className="text-center py-12 text-stone-500 font-medium">No episode data available yet.</div>;
  }

  const maxWeek = Math.max(...events.map(e => e.week), 0);
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);

  const matrix = chefs.map(chef => {
    const chefEvents = events.filter(e => e.chefId === chef.id);
    let isEliminated = false;
    
    const weekData = weeks.map(week => {
      const weekEvents = chefEvents.filter(e => e.week === week);
      
      const qf = weekEvents.find(e => e.description.startsWith('Quickfire:') || e.type.toLowerCase().includes('quickfire'));
      const elEvents = weekEvents.filter(e => e !== qf);
      
      const getPriority = (type: string) => {
        const t = type.toLowerCase();
        if (t.includes('eliminated')) return 1;
        if (t.includes('winner') || t.includes('winning')) return 2;
        if (t.includes('lck') || t.includes('last chance')) return 3;
        if (t.includes('win') && !t.includes('sweep')) return 4;
        if (t.includes('top') || t.includes('high')) return 5;
        if (t.includes('bottom') || t.includes('low')) return 6;
        return 7;
      };
      
      const el = elEvents.length > 0 ? [...elEvents].sort((a, b) => getPriority(a.type) - getPriority(b.type))[0] : undefined;
      
      if (el?.type.toUpperCase().includes('ELIMINATED')) {
        isEliminated = true;
      } else if (weekEvents.length > 0 && !el?.type.toUpperCase().includes('LCK') && !el?.type.toUpperCase().includes('LAST CHANCE')) {
        // If they have events that aren't LCK, they are back in the main competition
        isEliminated = false;
      }

      let qfStatus = '';
      let qfBgColor = 'bg-transparent';
      let qfTextColor = 'text-stone-500';

      if (qf) {
        const type = qf.type.toUpperCase();
        if (type.includes('WIN')) { qfStatus = 'WIN'; qfBgColor = 'bg-yellow-100'; qfTextColor = 'text-yellow-700'; }
        else if (type.includes('FAVORITE') || type.includes('TOP')) { qfStatus = 'HIGH'; qfBgColor = 'bg-blue-50'; qfTextColor = 'text-blue-600'; }
        else if (type.includes('LEAST') || type.includes('BOTTOM')) { qfStatus = 'LOW'; qfBgColor = 'bg-red-50'; qfTextColor = 'text-red-600'; }
        else { qfStatus = 'IN'; }
      }

      let status = '';
      let bgColor = 'bg-white';
      let textColor = 'text-stone-900';
      
      if (weekEvents.length === 0) {
        if (isEliminated) {
          status = '';
          bgColor = 'bg-stone-100';
        } else {
          // If there are no events but they aren't eliminated, they were SAFE
          // (assuming the week actually happened, which it did if maxWeek >= week)
          status = 'IN';
          bgColor = 'bg-white';
        }
      } else if (el) {
        const type = el.type.toUpperCase();
        if (type.includes('WINNER')) { status = 'WINNER'; bgColor = 'bg-yellow-300'; }
        else if (type.includes('RUNNER-UP')) { status = 'RUNNER-UP'; bgColor = 'bg-stone-300'; }
        else if (type.includes('LAST CHANCE KITCHEN WIN') || type.includes('LCK WIN')) { status = 'LCK WIN'; bgColor = 'bg-green-200'; }
        else if (type.includes('WIN')) { status = 'WIN'; bgColor = 'bg-blue-300'; }
        else if (type.includes('TOP')) { status = 'HIGH'; bgColor = 'bg-blue-100'; }
        else if (type.includes('BOTTOM')) { status = 'LOW'; bgColor = 'bg-red-200'; }
        else if (type.includes('ELIMINATED')) { 
          status = 'ELIM'; 
          bgColor = 'bg-red-500'; 
          textColor = 'text-white';
        } else {
          status = type;
        }
      } else {
        // Only quickfire events
        status = 'IN';
        bgColor = 'bg-white';
      }
      
      const totalPoints = weekEvents.reduce((sum, e) => sum + e.points, 0);
      
      return { week, status, qfStatus, qfBgColor, qfTextColor, weekEvents, totalPoints, bgColor, textColor };
    });
    
    return { chef, weekData, totalPoints: chef.totalScore };
  });

  // Sort by total points descending, then by name
  matrix.sort((a, b) => b.totalPoints - a.totalPoints || a.chef.name.localeCompare(b.chef.name));

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-stone-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-center border-collapse">
          <thead className="bg-stone-900 text-white font-bold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="px-4 py-3 text-left sticky left-0 bg-stone-900 z-10">Chef</th>
              {weeks.map(w => (
                <th key={w} className="px-2 py-3 border-l border-stone-700 min-w-[60px]">Ep {w}</th>
              ))}
              <th className="px-4 py-3 border-l border-stone-700 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {matrix.map(({ chef, weekData, totalPoints }) => (
              <tr key={chef.id} className="hover:bg-stone-50 transition-colors">
                <td className="px-4 py-3 font-bold text-stone-900 text-left sticky left-0 bg-white border-r border-stone-200 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                  <div className="flex items-center gap-2">
                    <span className="whitespace-nowrap">{chef.name}</span>
                  </div>
                </td>
                {weekData.map((data, i) => (
                  <td key={i} className={`px-2 py-2 border-l border-stone-200 ${data.bgColor} ${data.textColor} relative group`}>
                    <div className="flex flex-col items-center justify-center min-h-[36px] gap-0.5">
                      {data.qfStatus && (
                        <span className={`text-[8px] font-bold px-1 rounded-sm ${data.qfBgColor} ${data.qfTextColor} leading-none py-0.5`}>
                          QF: {data.qfStatus}
                        </span>
                      )}
                      <span className="font-black text-[10px] tracking-wider">{data.status}</span>
                      {data.totalPoints !== 0 && (
                        <span className={`text-[9px] font-bold ${data.textColor === 'text-white' ? 'text-white/80' : 'text-stone-500'}`}>
                          {data.totalPoints > 0 ? '+' : ''}{data.totalPoints}
                        </span>
                      )}
                    </div>
                    {/* Tooltip for detailed events */}
                    {data.weekEvents.length > 0 && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-stone-900 text-white text-xs rounded-lg p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 shadow-xl pointer-events-none">
                        {data.weekEvents.map((evt: any, idx: number) => (
                          <div key={idx} className="mb-1.5 last:mb-0">
                            <div className="flex justify-between items-start gap-2">
                              <span className="font-medium leading-tight">{evt.description}</span>
                              <span className="font-bold text-orange-400 shrink-0">
                                {evt.points > 0 ? '+' : ''}{evt.points}
                              </span>
                            </div>
                          </div>
                        ))}
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-stone-900 rotate-45"></div>
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-4 py-3 border-l border-stone-200 text-right font-black text-stone-900 bg-stone-50">
                  {totalPoints}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-4 bg-stone-50 border-t border-stone-200 text-[10px] text-stone-500 flex flex-wrap gap-4 justify-center">
        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-300 inline-block rounded-sm"></span> WINNER</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-300 inline-block rounded-sm"></span> WIN</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-100 inline-block rounded-sm"></span> HIGH</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-white border border-stone-200 inline-block rounded-sm"></span> IN</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-red-200 inline-block rounded-sm"></span> LOW</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 inline-block rounded-sm"></span> ELIM</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-green-200 inline-block rounded-sm"></span> LCK WIN</div>
      </div>
    </div>
  );
}

function ScoreboardView({ players, chefs, config, user, comments, onJoin, claimId, activePoll, showStatus, maxWeek }: { 
  players: Player[], 
  chefs: Chef[], 
  config: LeagueConfig | null, 
  user: User | null, 
  comments: PlayerStatus[],
  onJoin: () => void,
  claimId?: string | null,
  activePoll: Poll | null,
  showStatus: (type: 'success' | 'error' | 'info', message: string) => void,
  maxWeek: number
}) {
  const [editingProfile, setEditingProfile] = useState<Player | null>(null);
  const [subTab, setSubTab] = useState<'leaderboard' | 'chefs' | 'accuracy' | 'episodes'>('leaderboard');
  const [showBulletin, setShowBulletin] = useState(() => localStorage.getItem('hideScoringBulletin') !== 'true');
  const isAdmin = user?.email?.toLowerCase() === 'garrettlmiller@gmail.com';
  const isPlayer = user && players.some(p => p.id === user.uid);

  // --- Ranking Accuracy Logic ---
  const sortedChefs = [...chefs].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    // If scores are tied, active chefs rank higher than eliminated
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    return 0;
  });
  const actualChefOrder = sortedChefs.map(c => c.id);

  const playersWithBonus = useMemo(() => {
    if (chefs.length === 0 || players.length === 0) return players.map(p => ({ ...p, rankingBonus: 0, displayScore: p.totalScore, accuracy: 0, avgDiff: 0, accuracyRank: 0 }));

    // 1. Calculate raw accuracy for each player
    const playerAccuracies = players.map(player => {
      if (!player.rankings || player.rankings.length === 0) return { id: player.id, accuracy: 0, avgDiff: 0 };
      
      // Use all rankings that exist in the current chef list
      const uniqueRankings = [...new Set(player.rankings as string[])];
      const playerValidRankings = uniqueRankings.filter(id => actualChefOrder.includes(id));
      const playerActualOrder = actualChefOrder.filter(id => playerValidRankings.includes(id));
      
      let squaredDistance = 0;
      playerValidRankings.forEach((chefId, index) => {
        const actualIndex = playerActualOrder.indexOf(chefId);
        if (actualIndex !== -1) {
          squaredDistance += Math.pow(index - actualIndex, 2);
        }
      });

      const n = playerValidRankings.length;
      // Bell Curve (Gaussian) scoring
      // sigma controls how wide the bell curve is. 
      // A sigma of 4 means an RMS of 4 gives you ~60% of the max points.
      const sigma = 4; 
      const avgDiff = n > 0 ? Math.sqrt(squaredDistance / n) : 0; // RMS Diff
      
      // Calculate raw accuracy as a point on the bell curve
      const rawAccuracy = n > 0 ? Math.exp(-(avgDiff * avgDiff) / (2 * sigma * sigma)) : 0;
      
      return { id: player.id, rawAccuracy, avgDiff };
    });

    // 2. Rank players by avgDiff (lower is better)
    const sortedByAvgDiff = [...playerAccuracies].sort((a, b) => {
      if (a.avgDiff === 0 && b.avgDiff !== 0) return 1; // Put 0s at the end if they didn't rank
      if (b.avgDiff === 0 && a.avgDiff !== 0) return -1;
      return a.avgDiff - b.avgDiff;
    });
    
    const maxChefScore = Math.max(...chefs.map(c => c.totalScore), 0);
    const topRawAccuracy = Math.max(...playerAccuracies.map(p => p.rawAccuracy), 0);

    return players.map(player => {
      const accInfo = playerAccuracies.find(a => a.id === player.id);
      const rawAcc = accInfo?.rawAccuracy || 0;
      const avgDiff = accInfo?.avgDiff || 0;
      const rankIndex = sortedByAvgDiff.findIndex(a => a.id === player.id);
      
      // Normalize so the best player gets exactly 1.0 (100% of maxChefScore)
      const acc = topRawAccuracy > 0 ? (rawAcc / topRawAccuracy) : 0;
      
      // Points = maxChefScore * normalized_bell_curve_accuracy, rounded to nearest whole number
      const rankingBonus = Math.round(maxChefScore * acc);
      const displayScore = player.totalScore + rankingBonus;
      
      return { 
        ...player, 
        rankingBonus, 
        displayScore, 
        accuracy: acc,
        avgDiff,
        accuracyRank: rankIndex + 1
      };
    });
  }, [players, chefs, actualChefOrder]);

  const sortedPlayers = [...playersWithBonus].sort((a, b) => b.displayScore - a.displayScore);
  const accuracyLeaders = [...playersWithBonus].sort((a, b) => {
    if (a.avgDiff === 0 && b.avgDiff !== 0) return 1;
    if (b.avgDiff === 0 && a.avgDiff !== 0) return -1;
    return a.avgDiff - b.avgDiff;
  });

  return (
    <div className="space-y-3">
      {editingProfile && (
        <ProfileModal player={editingProfile} onClose={() => setEditingProfile(null)} showStatus={showStatus} />
      )}

      {/* New Feature Bulletin */}
      {showBulletin && (
        <div className="bg-orange-500 text-white p-4 rounded-2xl shadow-lg shadow-orange-200 flex items-center justify-between gap-4 animate-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-wider">New Scoring Feature!</p>
              <p className="text-[10px] opacity-90 font-bold">Check out the "Ranking Accuracy" tab to see your pre-draft bonus points.</p>
            </div>
          </div>
          <button 
            onClick={() => {
              setShowBulletin(false);
              localStorage.setItem('hideScoringBulletin', 'true');
            }} 
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Hero Header - Compact & Culinary */}
      <div className="relative h-28 sm:h-36 rounded-3xl overflow-hidden bg-stone-900 flex items-center justify-center">
        <div className="absolute inset-0 opacity-50">
          <img 
            src="https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&q=80&w=1200" 
            alt="Professional Kitchen" 
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/20 to-transparent" />
        </div>
        <div className="relative text-center px-2 sm:px-4">
          <h1 className="text-xl sm:text-4xl font-black text-white tracking-tighter uppercase italic leading-none">
            Top Chef <span className="text-[#7BAFD4]">Carolinas</span>
          </h1>
          <p className="text-stone-300 text-[8px] sm:text-[10px] font-bold uppercase tracking-[0.4em] mt-1">
            Fantasy League Standings
          </p>
        </div>
      </div>

      {/* Sub-Tabs for Mobile Optimization */}
      <div className="flex p-1 bg-stone-100 rounded-2xl gap-1">
        <button 
          onClick={() => setSubTab('leaderboard')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            subTab === 'leaderboard' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400 hover:text-stone-600'
          }`}
        >
          <Trophy className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Leaderboard</span>
          <span className="sm:hidden">Board</span>
        </button>
        <button 
          onClick={() => setSubTab('chefs')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            subTab === 'chefs' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400 hover:text-stone-600'
          }`}
        >
          <ChefHat className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Chef Ranks</span>
          <span className="sm:hidden">Chefs</span>
        </button>
        <button 
          onClick={() => setSubTab('accuracy')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            subTab === 'accuracy' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400 hover:text-stone-600'
          }`}
        >
          <Target className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Ranking Accuracy</span>
          <span className="sm:hidden">Accuracy</span>
        </button>
        <button 
          onClick={() => setSubTab('episodes')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            subTab === 'episodes' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400 hover:text-stone-600'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Episodes</span>
          <span className="sm:hidden">Ep</span>
        </button>
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        {subTab === 'leaderboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 space-y-2">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-orange-600" />
                  <h2 className="text-xl font-black text-stone-900 tracking-tight">Leaderboard</h2>
                  {maxWeek > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 text-[10px] font-bold uppercase tracking-wider border border-stone-200 ml-2">
                      Through Week {maxWeek}
                    </span>
                  )}
                </div>
                {user && !isPlayer && (
                  <div className="flex flex-col items-end gap-2">
                    {claimId && (
                      <div className="flex items-center gap-2 bg-orange-50 text-orange-600 px-3 py-1 rounded-lg border border-orange-100 animate-pulse">
                        <Zap className="w-3 h-3" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">
                          Claiming: {players.find(p => p.id === claimId)?.name || 'Profile'}
                        </span>
                      </div>
                    )}
                    <button 
                      onClick={onJoin}
                      className="bg-orange-600 text-white px-4 py-1.5 rounded-xl text-[10px] font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-100"
                    >
                      {claimId ? 'Confirm & Claim Profile' : 'Join League'}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3">
                {sortedPlayers.map((player, index) => (
                  <div key={player.id} className="group relative bg-white rounded-2xl border border-stone-200 p-4 hover:border-orange-200 hover:shadow-lg transition-all duration-200 overflow-hidden">
                    <div className={`absolute top-0 left-0 w-10 h-10 flex items-center justify-center transform -translate-x-2 -translate-y-2 rotate-[-12deg] z-10 ${
                      index === 0 ? 'bg-orange-500 shadow-lg shadow-orange-200' : index === 1 ? 'bg-stone-400' : index === 2 ? 'bg-orange-800' : 'bg-stone-100'
                    }`}>
                      <span className={`text-sm font-black ${index < 3 ? 'text-white' : 'text-stone-400'}`}>{index + 1}</span>
                    </div>

                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={() => user?.uid === player.id && setEditingProfile(player)}
                            disabled={user?.uid !== player.id}
                            className={`shrink-0 w-10 h-10 rounded-xl bg-stone-100 overflow-hidden border border-stone-200 transition-all ${
                              user?.uid === player.id ? 'hover:ring-2 hover:ring-orange-500 cursor-pointer' : ''
                            }`}
                          >
                            {player.photoURL ? (
                              <img src={player.photoURL} alt={player.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-lg font-black text-stone-400">
                                {player.name.charAt(0)}
                              </div>
                            )}
                          </button>
                          
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="text-base font-black text-stone-900 tracking-tight truncate shrink-0">
                                {player.displayName || player.name}
                              </h3>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                              {player.chefIds.map(chefId => {
                                const chef = chefs.find(c => c.id === chefId);
                                return (
                                  <div key={chefId} className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg border text-[9px] font-bold ${
                                    chef?.status !== 'active' 
                                      ? 'bg-stone-50 border-stone-100 text-stone-400 line-through' 
                                      : 'bg-white border-stone-100 text-stone-600'
                                  }`}>
                                    <div className={`w-1 h-1 rounded-full ${
                                      chef?.status === 'active' ? 'bg-green-500' : 
                                      chef?.status === 'lck' ? 'bg-blue-500' : 'bg-red-500'
                                    }`} />
                                    {chef?.name || 'Unknown'}
                                  </div>
                                );
                              })}
                            </div>
                            <KitchenConfessional playerId={player.id} user={user} comments={comments} />
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-right pt-1">
                        <div className="flex flex-col items-end gap-0.5 mb-1.5">
                          <div className="flex items-center gap-2 text-[10px] font-bold text-stone-500">
                            <span className="uppercase tracking-wider">Chefs</span>
                            <span className="text-stone-900">{player.totalScore}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-bold text-orange-600">
                            <span className="uppercase tracking-wider">Bonus</span>
                            <span>+{player.rankingBonus}</span>
                          </div>
                        </div>
                        <div className="text-2xl font-black text-stone-900 tracking-tighter leading-none border-t border-stone-100 pt-1.5">
                          {player.displayScore}
                        </div>
                        <div className="text-[8px] text-stone-400 font-black uppercase tracking-widest mt-1">Total Pts</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="lg:col-span-4 space-y-6">
              <PollWidget poll={activePoll} user={user} />
            </div>
          </div>
        )}

        {subTab === 'chefs' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-2">
              <ChefHat className="w-5 h-5 text-stone-900" />
              <h2 className="text-xl font-black text-stone-900 tracking-tight">Chef Ranks</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[...chefs].sort((a, b) => {
                if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
                return a.name.localeCompare(b.name);
              }).map((chef, i) => (
                <div key={chef.id} className="bg-white rounded-2xl border border-stone-200 p-4 flex items-center justify-between group hover:border-orange-200 transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center font-black text-stone-400 text-xs">
                      {i + 1}
                    </div>
                    <div>
                      <div className={`font-bold text-sm ${chef.status === 'eliminated' ? 'text-stone-400 line-through' : 'text-stone-900'}`}>
                        {chef.name}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          chef.status === 'active' ? 'bg-green-500' : 
                          chef.status === 'lck' ? 'bg-blue-500' : 'bg-red-500'
                        }`} />
                        <span className="text-[8px] font-black uppercase tracking-wider text-stone-400">{chef.status}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-black text-orange-600 text-lg tracking-tighter">{chef.totalScore}</div>
                    <div className="text-[8px] font-bold uppercase text-stone-400">Points</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {subTab === 'accuracy' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-2">
              <Target className="w-5 h-5 text-orange-600" />
              <h2 className="text-xl font-black text-stone-900 tracking-tight">Ranking Accuracy</h2>
            </div>
            
            <div className="bg-stone-900 rounded-3xl p-6 text-white mb-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="bg-orange-500 p-1.5 rounded-lg">
                  <Info className="w-4 h-4 text-white" />
                </div>
                <p className="text-xs font-black uppercase tracking-widest text-orange-500">How Scoring Works</p>
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-black uppercase text-stone-400 tracking-wider">1. The Bonus Pool</h4>
                    <p className="text-xs text-stone-300 leading-relaxed">
                      The maximum bonus is equal to the <strong>highest scoring chef</strong> in the competition ({Math.max(...chefs.map(c => c.totalScore), 0)} pts). 
                      A perfect draft (RMS Diff of 0) receives this full amount.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-black uppercase text-stone-400 tracking-wider">2. Bell Curve Distribution</h4>
                    <p className="text-xs text-stone-300 leading-relaxed">
                      Players receive a share of the max bonus based on a <strong>Bell Curve (Gaussian)</strong> distribution of their RMS Diff. 
                      This heavily rewards highly accurate drafts, while smoothly tapering off for less accurate ones.
                    </p>
                  </div>
                </div>
                
                <div className="pt-4 border-t border-white/10">
                  <p className="text-[10px] text-stone-500 italic">
                    Note: Accuracy is calculated using the full field of chefs. If you ranked an eliminated chef highly, it will impact your accuracy score, rewarding those who correctly predicted the season's outcome.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {accuracyLeaders.map((player, index) => (
                <AccuracyItem 
                  key={player.id} 
                  player={player} 
                  index={index} 
                  actualChefOrder={actualChefOrder} 
                  chefs={chefs} 
                />
              ))}
            </div>
          </div>
        )}

        {subTab === 'episodes' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-2">
              <History className="w-5 h-5 text-orange-600" />
              <h2 className="text-xl font-black text-stone-900 tracking-tight">Progress Table</h2>
            </div>
            <ProgressTable chefs={chefs} />
          </div>
        )}
      </div>
    </div>
  );
}

function AccuracyItem({ player, index, actualChefOrder, chefs }: { player: any, index: number, actualChefOrder: string[], chefs: Chef[], key?: any }) {
  const [showDetails, setShowDetails] = useState(false);

  const breakdown = useMemo(() => {
    if (!player.rankings) return [];
    const uniqueRankings = [...new Set(player.rankings as string[])];
    const playerValidRankings = uniqueRankings.filter((id: string) => actualChefOrder.includes(id));
    const playerActualOrder = actualChefOrder.filter(id => playerValidRankings.includes(id));
    
    return playerValidRankings
      .map((chefId: string, idx: number) => {
        const chef = chefs.find(c => c.id === chefId);
        const actualIdx = playerActualOrder.indexOf(chefId);
        const distance = Math.abs(idx - actualIdx);
        return {
          name: chef?.name || 'Unknown',
          status: chef?.status || 'active',
          predicted: idx + 1,
          actual: actualIdx + 1,
          distance
        };
      });
  }, [player.rankings, actualChefOrder, chefs]);

  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden transition-all duration-300">
      <div 
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-stone-50"
        onClick={() => setShowDetails(!showDetails)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${
            index === 0 ? 'bg-orange-500 text-white' : 'bg-stone-100 text-stone-400'
          }`}>
            {index + 1}
          </div>
          <div>
            <div className="font-bold text-sm text-stone-900">{player.displayName || player.name}</div>
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-bold text-stone-400">
                RMS Diff: {player.avgDiff.toFixed(2)}
              </div>
              <div className="w-1 h-1 rounded-full bg-stone-200" />
              <div className="text-[10px] font-bold text-orange-500 uppercase tracking-wider">
                {showDetails ? 'Hide Breakdown' : 'View Breakdown'}
              </div>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-black text-orange-600 text-lg tracking-tighter">+{player.rankingBonus}</div>
          <div className="text-[8px] font-bold uppercase text-stone-400">Bonus Points</div>
        </div>
      </div>

      <AnimatePresence>
        {showDetails && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-stone-100 bg-stone-50 overflow-hidden"
          >
            <div className="p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-stone-200">
                      <th className="py-2 text-[8px] font-black uppercase text-stone-400 tracking-widest">Chef</th>
                      <th className="py-2 text-[8px] font-black uppercase text-stone-400 tracking-widest text-center">Ranked</th>
                      <th className="py-2 text-[8px] font-black uppercase text-stone-400 tracking-widest text-center">Actual</th>
                      <th className="py-2 text-[8px] font-black uppercase text-stone-400 tracking-widest text-right">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.map((item: any, i: number) => (
                      <tr key={i} className="border-b border-stone-100 last:border-0">
                        <td className="py-2 text-[10px] font-bold text-stone-700">
                          {item.name}
                          {item.status === 'eliminated' && <span className="ml-1 text-[8px] text-red-500 font-black uppercase">Out</span>}
                        </td>
                        <td className="py-2 text-[10px] font-black text-stone-900 text-center">#{item.predicted}</td>
                        <td className="py-2 text-[10px] font-black text-orange-600 text-center">#{item.actual}</td>
                        <td className="py-2 text-[10px] font-bold text-stone-400 text-right">
                          {item.distance === 0 ? (
                            <CheckCircle2 className="w-3 h-3 text-green-500 ml-auto" />
                          ) : (
                            `±${item.distance}`
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 p-3 bg-white rounded-xl border border-stone-200">
                <p className="text-[9px] text-stone-500 leading-relaxed">
                  <strong>Calculation:</strong> We sum the squared difference between your ranked position and the chef's current standing, then take the square root of the average. 
                  This penalizes large misses more than small ones and breaks ties. Lower RMS Diff = higher accuracy.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CompactAccuracyItem({ player, index, isMe, actualChefOrder, chefs }: { player: any, index: number, isMe: boolean, actualChefOrder: string[], chefs: Chef[], key?: any }) {
  const [showDetails, setShowDetails] = useState(false);

  const breakdown = useMemo(() => {
    if (!player.rankings) return [];
    const uniqueRankings = [...new Set(player.rankings as string[])];
    const playerValidRankings = uniqueRankings.filter((id: string) => actualChefOrder.includes(id));
    const playerActualOrder = actualChefOrder.filter(id => playerValidRankings.includes(id));
    
    return playerValidRankings
      .map((chefId: string, idx: number) => {
        const chef = chefs.find(c => c.id === chefId);
        const actualIdx = playerActualOrder.indexOf(chefId);
        const distance = Math.abs(idx - actualIdx);
        return {
          name: chef?.name || 'Unknown',
          status: chef?.status || 'active',
          predicted: idx + 1,
          actual: actualIdx + 1,
          distance
        };
      });
  }, [player.rankings, actualChefOrder, chefs]);

  return (
    <div className={`rounded-2xl border transition-all overflow-hidden ${
      isMe ? 'bg-white/10 border-orange-500/50' : 'bg-white/5 border-white/5'
    }`}>
      <div 
        className="p-4 cursor-pointer hover:bg-white/5"
        onClick={() => setShowDetails(!showDetails)}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-black text-stone-500">#{index + 1}</span>
            <span className="font-bold text-sm">{player.displayName || player.name}</span>
          </div>
          <span className="text-orange-500 font-black text-sm">+{player.rankingBonus} pts</span>
        </div>
        <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
          <div 
            className="bg-orange-500 h-full transition-all duration-1000" 
            style={{ width: `${Math.round(player.accuracy * 100)}%` }} 
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
            {showDetails ? 'Hide Details' : 'View Breakdown'}
          </span>
          <span className="text-[10px] font-bold text-stone-300">RMS Diff: {player.avgDiff.toFixed(2)}</span>
        </div>
      </div>

      <AnimatePresence>
        {showDetails && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-black/20 border-t border-white/5 overflow-hidden"
          >
            <div className="p-4 space-y-2">
              {breakdown.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-[10px] py-1 border-b border-white/5 last:border-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-stone-400 truncate">{item.name}</span>
                    {item.status === 'eliminated' && <span className="text-[7px] text-red-500 font-black uppercase shrink-0">Out</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-stone-500">#{item.predicted}</span>
                    <span className="text-stone-300">→</span>
                    <span className="text-orange-500 font-bold">#{item.actual}</span>
                    <span className={`font-bold ${item.distance === 0 ? 'text-green-500' : 'text-stone-500'}`}>
                      {item.distance === 0 ? '✓' : `±${item.distance}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DraftView({ config, players, chefs, isAdmin, onAutoDraft, onFullAutoDraft, isSubmitting, showStatus }: { 
  config: LeagueConfig | null, 
  players: Player[], 
  chefs: Chef[], 
  isAdmin: boolean,
  onAutoDraft: () => Promise<void>,
  onFullAutoDraft: () => Promise<void>,
  isSubmitting: boolean,
  showStatus: (type: 'success' | 'error' | 'info', message: string) => void
}) {
  const avgRankings = useMemo(() => {
    const playersWithRankings = players.filter(p => p.rankings && p.rankings.length > 0);
    const chefRankSums: Record<string, number> = {};
    const chefRankCounts: Record<string, number> = {};

    playersWithRankings.forEach(player => {
      player.rankings!.forEach((chefId, index) => {
        chefRankSums[chefId] = (chefRankSums[chefId] || 0) + (index + 1);
        chefRankCounts[chefId] = (chefRankCounts[chefId] || 0) + 1;
      });
    });

    return chefs
      .map(chef => ({
        ...chef,
        avgRank: chefRankCounts[chef.id] ? chefRankSums[chef.id] / chefRankCounts[chef.id] : 99
      }))
      .sort((a, b) => a.avgRank - b.avgRank);
  }, [chefs, players]);

  const draftGrades = useMemo(() => {
    if (!config || !config.draftCompleted) return [];

    const avgRankMap = new Map<string, number>(avgRankings.map(c => [c.id, c.avgRank]));
    const N = players.length;

    return players.map(player => {
      const orderIndex = config.draftOrder.indexOf(player.id);
      if (orderIndex === -1) return { ...player, grade: 'N/A', score: 0, details: [] };

      const picks = [
        { chefId: player.chefIds[0], turn: orderIndex },
        { chefId: player.chefIds[1], turn: 2 * N - 1 - orderIndex }
      ];

      let totalValue = 0;
      const details = picks.map(pick => {
        const chef = chefs.find(c => c.id === pick.chefId);
        const actualPick = pick.turn + 1;
        const expectedPick = avgRankMap.get(pick.chefId) || actualPick;
        const value = actualPick - expectedPick;
        totalValue += value;
        return {
          chefName: chef?.name || 'Unknown',
          actualPick,
          expectedPick: expectedPick.toFixed(1),
          value: value.toFixed(1)
        };
      });

      let grade = 'C';
      if (totalValue > 5) grade = 'A+';
      else if (totalValue > 3) grade = 'A';
      else if (totalValue > 1) grade = 'B+';
      else if (totalValue > -1) grade = 'B';
      else if (totalValue > -3) grade = 'C+';
      else if (totalValue > -5) grade = 'C';
      else grade = 'D';

      return {
        ...player,
        grade,
        score: totalValue,
        details
      };
    }).sort((a, b) => b.score - a.score);
  }, [avgRankings, players, config, chefs]);

  if (!config) return <div className="p-12 text-center text-stone-400">League not initialized.</div>;

  const availableChefs = chefs.filter(c => !players.some(p => p.chefIds.includes(c.id)) && c.status === 'active');
  
  // Snake draft logic
  const totalPicks = players.length * 2;
  const currentPickIndex = config.currentDraftTurn;
  
  const getPlayerForTurn = (turn: number) => {
    const round = Math.floor(turn / players.length);
    const indexInRound = turn % players.length;
    const playerIndex = round % 2 === 0 ? indexInRound : (players.length - 1 - indexInRound);
    const playerId = config.draftOrder[playerIndex];
    return players.find(p => p.id === playerId);
  };

  const currentPlayer = getPlayerForTurn(currentPickIndex);
  const isMyTurn = currentPlayer?.id === auth.currentUser?.uid || (isAdmin && !config.draftCompleted);

  const handleDraft = async (chefId: string) => {
    if (!isMyTurn || config.draftCompleted) return;

    try {
      await runTransaction(db, async (transaction) => {
        const playerRef = doc(db, 'players', currentPlayer!.id);
        const configRef = doc(db, 'config', 'league');
        
        const playerSnap = await transaction.get(playerRef);
        const configSnap = await transaction.get(configRef);
        
        if (!playerSnap.exists() || !configSnap.exists()) {
          throw new Error("Player or Config document missing");
        }

        const currentChefIds = playerSnap.data().chefIds || [];
        transaction.update(playerRef, {
          chefIds: [...currentChefIds, chefId]
        });

        const nextTurn = currentPickIndex + 1;
        transaction.update(configRef, {
          currentDraftTurn: nextTurn,
          draftCompleted: nextTurn >= totalPicks
        });
      });
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, `players/${currentPlayer?.id}`);
      showStatus('error', 'Draft failed.');
    }
  };

  const startDraft = async () => {
    if (!isAdmin) return;
    await updateDoc(doc(db, 'config', 'league'), { draftStarted: true });
  };

  if (!config.draftStarted) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 p-8 sm:p-12 text-center space-y-6 shadow-sm">
        <Dice5 className="w-12 h-12 text-orange-600 mx-auto" />
        <h2 className="text-xl sm:text-2xl font-bold">The Draft hasn't started yet</h2>
        <p className="text-stone-500 max-w-md mx-auto text-sm sm:text-base">Wait for the admin to randomize the order and start the snake draft.</p>
        {isAdmin && (
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button 
              onClick={startDraft} 
              className="bg-orange-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200 min-h-[44px]"
            >
              Start Draft
            </button>
            <button 
              onClick={onFullAutoDraft} 
              disabled={isSubmitting}
              className="bg-stone-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-stone-800 transition-all shadow-lg shadow-stone-200 min-h-[44px] flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" />
              Run Full Auto-Draft
            </button>
          </div>
        )}
      </div>
    );
  }

  if (config.draftCompleted) {
    return (
      <div className="space-y-8">
        <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
          <h2 className="text-xl sm:text-2xl font-bold mb-6 flex items-center gap-2">
            <Trophy className="w-6 h-6 text-orange-600" />
            Draft Recap & Grades
          </h2>
          <p className="text-stone-500 mb-8">The draft is complete! Here is a recap of how everyone performed based on the consensus pre-draft rankings.</p>
          <div className="space-y-4">
            {draftGrades.map((player) => (
              <div key={player.id} className="p-4 sm:p-6 bg-stone-50 rounded-2xl border border-stone-100">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-lg">{player.name}</h3>
                    <div className="text-xs text-stone-400 font-bold uppercase tracking-wider">
                      Total Value: <span className={player.score >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {player.score > 0 ? '+' : ''}{player.score.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div className="text-3xl font-black text-orange-600">{player.grade}</div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {player.details.map((detail, i) => (
                    <div key={i} className="bg-white p-3 rounded-xl border border-stone-200 text-sm">
                      <div className="font-bold mb-1">{detail.chefName}</div>
                      <div className="flex justify-between text-stone-500">
                        <span>Picked at:</span>
                        <span className="font-medium text-stone-900">{detail.actualPick}</span>
                      </div>
                      <div className="flex justify-between text-stone-500">
                        <span>Expected:</span>
                        <span className="font-medium text-stone-900">{detail.expectedPick}</span>
                      </div>
                      <div className="flex justify-between mt-1 pt-1 border-t border-stone-50">
                        <span>Value:</span>
                        <span className={`font-bold ${parseFloat(detail.value) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {parseFloat(detail.value) > 0 ? '+' : ''}{detail.value}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
      <div className="lg:col-span-2 space-y-4 sm:space-y-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h2 className="text-lg sm:text-xl font-bold">Available Chefs</h2>
            <div className="flex items-center gap-3">
              {isAdmin && !config.draftCompleted && (
                <button 
                  onClick={onFullAutoDraft}
                  disabled={isSubmitting}
                  className="hidden sm:flex items-center gap-2 bg-orange-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-700 transition-all disabled:opacity-50"
                >
                  <Zap className="w-3 h-3" />
                  Auto-Finish
                </button>
              )}
              <div className="text-xs sm:text-sm font-medium text-stone-500">Pick {currentPickIndex + 1} of {totalPicks}</div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {availableChefs.map(chef => (
              <button 
                key={chef.id}
                disabled={!isMyTurn || config.draftCompleted}
                onClick={() => handleDraft(chef.id)}
                className={`flex items-center justify-between p-3 sm:p-4 rounded-xl border transition-all text-left min-h-[56px] ${
                  isMyTurn && !config.draftCompleted
                    ? 'border-stone-200 hover:border-orange-500 hover:bg-orange-50 cursor-pointer'
                    : 'border-stone-100 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-stone-100 flex items-center justify-center shrink-0">
                    <ChefHat className="w-4 h-4 sm:w-5 sm:h-5 text-stone-400" />
                  </div>
                  <span className="font-bold text-sm sm:text-base">{chef.name}</span>
                </div>
                {isMyTurn && !config.draftCompleted && <Plus className="w-5 h-5 text-orange-500 shrink-0" />}
              </button>
            ))}
          </div>
          {availableChefs.length === 0 && (
            <div className="p-12 text-center text-stone-400">
              {config.draftCompleted ? 'Draft is complete!' : 'No chefs available.'}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 sm:space-y-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-6 shadow-sm">
          <h2 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6">Draft Order</h2>
          <div className="space-y-2 sm:space-y-3">
            {Array.from({ length: totalPicks }).map((_, i) => {
              const player = getPlayerForTurn(i);
              const isCurrent = i === currentPickIndex;
              const isPast = i < currentPickIndex;
              
              return (
                <div key={i} className={`flex items-center gap-3 p-2 sm:p-3 rounded-xl border transition-all ${
                  isCurrent ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-100' : 'border-stone-100'
                } ${isPast ? 'opacity-50' : ''}`}>
                  <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isCurrent ? 'bg-orange-500 text-white' : 'bg-stone-100 text-stone-400'
                  }`}>
                    {i + 1}
                  </div>
                  <span className={`font-bold text-xs sm:text-sm truncate ${isCurrent ? 'text-orange-900' : 'text-stone-600'}`}>
                    {player?.name}
                  </span>
                  {isCurrent && <div className="ml-auto w-2 h-2 rounded-full bg-orange-500 animate-pulse shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SortableChefItemProps {
  key?: string | number;
  id: string;
  chef: Chef;
  index: number;
  moveItem: (index: number, direction: 'up' | 'down') => void;
  isLast: boolean;
}

function SortableChefItem({ id, chef, index, moveItem, isLast }: SortableChefItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
    position: 'relative' as const,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={`flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-stone-50 border border-stone-200 rounded-xl group touch-none ${isDragging ? 'shadow-lg ring-2 ring-orange-500 bg-white' : ''}`}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 -ml-1 text-stone-300 hover:text-stone-500 transition-colors">
        <GripVertical className="w-5 h-5" />
      </div>
      <div className="shrink-0 w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center font-bold text-stone-500 text-sm">
        {index + 1}
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="font-bold text-sm sm:text-base truncate">{chef.name}</div>
        <div className="text-[10px] sm:text-xs text-stone-400 truncate">{chef.hometown}</div>
      </div>
      <div className="flex gap-1 shrink-0">
        <button 
          onClick={() => moveItem(index, 'up')}
          disabled={index === 0}
          className="p-2 hover:bg-white rounded-lg transition-colors disabled:opacity-20 min-h-[44px] min-w-[44px] flex items-center justify-center sm:flex hidden"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
        <button 
          onClick={() => moveItem(index, 'down')}
          disabled={isLast}
          className="p-2 hover:bg-white rounded-lg transition-colors disabled:opacity-20 min-h-[44px] min-w-[44px] flex items-center justify-center sm:flex hidden"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function RankingView({ chefs, player, players, config, isAdmin = false }: { chefs: Chef[], player?: Player, players: Player[], config: LeagueConfig | null, isAdmin?: boolean }) {
  const [rankedIds, setRankedIds] = useState<string[]>(player?.rankings || []);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // --- Ranking Accuracy Logic for Comparison ---
  const activeChefs = chefs.filter(c => c.status !== 'eliminated').sort((a, b) => b.totalScore - a.totalScore);
  const sortedChefs = [...chefs].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    // If scores are tied, active chefs rank higher than eliminated
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    return 0;
  });
  const actualChefOrder = sortedChefs.map(c => c.id);

  const playersWithBonus = useMemo(() => {
    if (chefs.length === 0 || players.length === 0) return players.map(p => ({ ...p, rankingBonus: 0, accuracy: 0, avgDiff: 0 }));

    const playerAccuracies = players.map(p => {
      if (!p.rankings || p.rankings.length === 0) return { id: p.id, accuracy: 0, avgDiff: 0 };
      const uniqueRankings = [...new Set(p.rankings as string[])];
      const playerActiveRankings = uniqueRankings.filter(id => actualChefOrder.includes(id));
      const playerActualOrder = actualChefOrder.filter(id => playerActiveRankings.includes(id));
      let squaredDistance = 0;
      playerActiveRankings.forEach((chefId, index) => {
        const actualIndex = playerActualOrder.indexOf(chefId);
        if (actualIndex !== -1) squaredDistance += Math.pow(index - actualIndex, 2);
      });
      const n = playerActiveRankings.length;
      const sigma = 4; 
      const avgDiff = n > 0 ? Math.sqrt(squaredDistance / n) : 0; // RMSE
      const rawAccuracy = n > 0 ? Math.exp(-(avgDiff * avgDiff) / (2 * sigma * sigma)) : 0;
      return { id: p.id, rawAccuracy, avgDiff };
    });

    const maxChefScore = Math.max(...chefs.map(c => c.totalScore), 0);
    const topRawAccuracy = Math.max(...playerAccuracies.map(p => p.rawAccuracy), 0);

    return players.map(p => {
      const accInfo = playerAccuracies.find(a => a.id === p.id);
      const rawAcc = accInfo?.rawAccuracy || 0;
      const avgDiff = accInfo?.avgDiff || 0;
      const acc = topRawAccuracy > 0 ? (rawAcc / topRawAccuracy) : 0;
      const rankingBonus = Math.round(maxChefScore * acc);
      return { ...p, rankingBonus, accuracy: acc, avgDiff };
    });
  }, [players, chefs, actualChefOrder]);

  const sortedComparison = [...playersWithBonus].sort((a, b) => {
    if (a.avgDiff === 0 && b.avgDiff !== 0) return 1;
    if (b.avgDiff === 0 && a.avgDiff !== 0) return -1;
    return a.avgDiff - b.avgDiff;
  });

  useEffect(() => {
    if (player?.rankings) {
      setRankedIds(player.rankings);
    } else {
      setRankedIds([]);
    }
  }, [player?.id]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const currentActiveIds = activeChefs.map(c => c.id);
    const newRankedIds: string[] = Array.from(new Set(rankedIds)); // Remove any existing duplicates
    currentActiveIds.forEach(id => {
      if (!newRankedIds.includes(id)) newRankedIds.push(id);
    });
    const filteredRankedIds = newRankedIds.filter(id => currentActiveIds.includes(id));
    if (JSON.stringify(filteredRankedIds) !== JSON.stringify(rankedIds)) {
      setRankedIds(filteredRankedIds);
    }
  }, [chefs]);

  const isLocked = !config?.rankingsOpen && !isAdmin;

  const moveItem = (index: number, direction: 'up' | 'down') => {
    if (isLocked) return;
    const newIds = [...rankedIds];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newIds.length) return;
    [newIds[index], newIds[targetIndex]] = [newIds[targetIndex], newIds[index]];
    setRankedIds(newIds);
    setSaveStatus('idle');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (isLocked) return;
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setRankedIds((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
      setSaveStatus('idle');
    }
  };

  const handleSave = async () => {
    if (!player) {
      console.error('No player profile found to save rankings for.');
      setSaveStatus('error');
      return;
    }
    setIsSaving(true);
    setSaveStatus('saving');
    try {
      await updateDoc(doc(db, 'players', player.id), {
        rankings: rankedIds
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      console.error('Save error:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  if (!player) {
    return (
      <div className="max-w-2xl mx-auto p-8 sm:p-12 text-center bg-white rounded-2xl border border-stone-200 shadow-sm space-y-6">
        <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto">
          <AlertCircle className="w-8 h-8 text-stone-400" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Player Profile Not Found</h2>
          <p className="text-stone-500 mt-2 text-sm sm:text-base">
            You need to be a registered player in the league to set rankings.
          </p>
        </div>
        <p className="text-xs text-stone-400 italic">
          Go to the Scoreboard and click "Join League" to create your profile.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <div className="lg:col-span-7 space-y-6">
        <div className="bg-white rounded-3xl border border-stone-200 p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h2 className="text-2xl font-black text-stone-900 tracking-tight">Pre-Draft Rankings</h2>
              <p className="text-stone-500 text-sm mt-1">Drag to reorder or use arrows. These rankings determine your accuracy bonus.</p>
            </div>
            <div className="flex items-center gap-3">
              {isLocked && (
                <div className="flex items-center gap-2 text-stone-400 font-bold text-xs bg-stone-100 px-3 py-1.5 rounded-lg">
                  <Lock className="w-3.5 h-3.5" />
                  Rankings Locked
                </div>
              )}
              {saveStatus === 'saved' && (
                <div className="flex items-center gap-2 text-green-600 font-bold text-xs animate-in fade-in slide-in-from-right-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Saved
                </div>
              )}
              <button 
                onClick={handleSave}
                disabled={isSaving || isLocked}
                className={`px-6 py-2.5 rounded-xl font-bold transition-all disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2 shadow-lg shadow-stone-100 ${
                  isLocked ? 'bg-stone-100 text-stone-400 cursor-not-allowed' :
                  saveStatus === 'saved' ? 'bg-green-600 text-white' : 
                  saveStatus === 'error' ? 'bg-red-600 text-white' : 
                  'bg-stone-900 text-white hover:bg-stone-800'
                }`}
              >
                {isLocked ? 'Rankings Locked' : saveStatus === 'saving' ? 'Saving...' : 'Save Rankings'}
              </button>
            </div>
          </div>

          <DndContext 
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext 
              items={rankedIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {rankedIds.map((id, index) => {
                  const chef = chefs.find(c => c.id === id);
                  if (!chef) return null;
                  return (
                    <SortableChefItem 
                      key={id} 
                      id={id} 
                      chef={chef} 
                      index={index} 
                      moveItem={moveItem}
                      isLast={index === rankedIds.length - 1}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>

      <div className="lg:col-span-5 space-y-6">
        <div className="bg-stone-900 rounded-3xl p-8 text-white shadow-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-orange-500 p-2 rounded-xl">
              <Target className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl font-black tracking-tight">League Accuracy Comparison</h2>
          </div>
          
          <div className="space-y-4">
            {sortedComparison.map((p, i) => (
              <CompactAccuracyItem 
                key={p.id} 
                player={p} 
                index={i} 
                isMe={p.id === player?.id}
                actualChefOrder={actualChefOrder}
                chefs={chefs}
              />
            ))}
          </div>

          <div className="mt-8 pt-8 border-t border-white/10">
            <h3 className="text-sm font-bold mb-2">What is this?</h3>
            <p className="text-xs text-stone-400 leading-relaxed">
              Your pre-draft rankings are compared to the actual chef standings. 
              The most accurate predictor gets a bonus equal to the highest scoring chef. 
              Other players receive a proportional share based on how close their differential is to the top player.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsView({ chefs, players, config }: { chefs: Chef[], players: Player[], config: LeagueConfig | null }) {
  const avgRankings = useMemo(() => {
    const playersWithRankings = players.filter(p => p.rankings && p.rankings.length > 0);
    if (playersWithRankings.length === 0) return [];

    const chefRankSums: { [id: string]: number } = {};
    const chefRankCounts: { [id: string]: number } = {};

    playersWithRankings.forEach(player => {
      player.rankings!.forEach((chefId, index) => {
        chefRankSums[chefId] = (chefRankSums[chefId] || 0) + (index + 1);
        chefRankCounts[chefId] = (chefRankCounts[chefId] || 0) + 1;
      });
    });

    return chefs
      .map(chef => ({
        ...chef,
        avgRank: chefRankCounts[chef.id] ? chefRankSums[chef.id] / chefRankCounts[chef.id] : 99
      }))
      .sort((a, b) => a.avgRank - b.avgRank);
  }, [chefs, players]);

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-bold mb-6 flex items-center gap-2">
          <ListOrdered className="w-6 h-6 text-orange-600" />
          Consensus Rankings
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {avgRankings.map((chef, index) => (
            <div key={chef.id} className="flex items-center justify-between p-3 bg-stone-50 rounded-xl border border-stone-100">
              <div className="flex items-center gap-3">
                <span className="text-stone-400 font-bold text-sm w-6">{index + 1}</span>
                <span className="font-medium">{chef.name}</span>
              </div>
              <div className="text-right">
                <div className="text-xs text-stone-400 uppercase font-bold tracking-wider">Avg Rank</div>
                <div className="font-bold text-orange-600">{chef.avgRank.toFixed(1)}</div>
              </div>
            </div>
          ))}
        </div>
        {avgRankings.length === 0 && (
          <p className="text-center text-stone-400 py-8">No rankings submitted yet.</p>
        )}
      </div>
    </div>
  );
}

function ScoringView() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-stone-900">
          <Info className="w-6 h-6 text-orange-600" />
          Scoring Rules
        </h2>
        
        <div className="space-y-8">
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-4 border-b border-stone-100 pb-2">Episode Scoring</h3>
            <p className="text-stone-500 text-sm mb-6 bg-stone-50 p-4 rounded-xl border border-stone-100 italic">
              Note: Chefs receive negative points if they are in the bottom 3 or eliminated. In a single episode, a chef cannot earn points for both winning the Elimination Challenge (+7) and being Top of Judge’s Table (+3).
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ScoreRule label="Quickfire: Win" points="+5" />
              <ScoreRule label="Quickfire: Favorite Dishes" points="+2" />
              <ScoreRule label="Quickfire: Least Favorite Dishes" points="-1" variant="negative" />
              <ScoreRule label="Elimination Challenge: Win" points="+7" />
              <ScoreRule label="Episode Sweep Bonus" points="+3" sublabel="Win Quickfire & Elimination" />
              <ScoreRule label="Judges’ Table: Top" points="+4" />
              <ScoreRule label="Judges’ Table: Bottom" points="-2" variant="negative" />
              <ScoreRule label="Chef Eliminated" points="-2" variant="negative" sublabel="Bottom 3 Penalty" />
              <ScoreRule label="Last Chance Kitchen: Win" points="+2" />
            </div>
          </section>

          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-4 border-b border-stone-100 pb-2">Season Finale Scoring</h3>
            <p className="text-stone-500 text-sm mb-6 bg-stone-50 p-4 rounded-xl border border-stone-100 italic">
              Note: The finale is categorized as the last episode of the season. For the season finale, a chef will not receive bonus points for both making the finale and winning. The maximum possible score for a finale win is 30 points, not 45.
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ScoreRule label="Making The Season Finale" points="+15" />
              <ScoreRule label="Winning Top Chef" points="+30" />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ScoreRule({ label, points, sublabel, variant = 'positive' }: { label: string, points: string, sublabel?: string, variant?: 'positive' | 'negative' }) {
  return (
    <div className="flex items-center justify-between p-4 bg-stone-50 rounded-xl border border-stone-100">
      <div>
        <div className="font-bold text-stone-900 text-sm sm:text-base">{label}</div>
        {sublabel && <div className="text-[10px] text-stone-400 uppercase font-bold tracking-wider">{sublabel}</div>}
      </div>
      <div className={`text-lg font-black ${variant === 'positive' ? 'text-orange-600' : 'text-red-500'}`}>
        {points}
      </div>
    </div>
  );
}

const TOP_CHEF_SEASONS = [
  { label: 'Season 22: Carolinas', url: 'https://en.wikipedia.org/wiki/Top_Chef:_Carolinas' },
  { label: 'Season 22 (Alt 1)', url: 'https://en.wikipedia.org/wiki/Top_Chef_(season_22)' },
  { label: 'Season 22 (Alt 2)', url: 'https://en.wikipedia.org/wiki/Top_Chef_(American_season_22)' },
  { label: 'Season 22 (Alt 3)', url: 'https://en.wikipedia.org/wiki/Top_Chef_Season_22' },
  { label: 'Season 22 (Fandom)', url: 'https://topchef.fandom.com/wiki/Top_Chef:_Carolinas' },
];

function ScraperTool({ chefs, players, showStatus }: { chefs: Chef[], players: Player[], showStatus: (type: 'success' | 'error' | 'info', message: string) => void }) {
  const [wikitext, setWikitext] = useState('');
  const [url, setUrl] = useState(TOP_CHEF_SEASONS[0].url);
  const [isFetching, setIsFetching] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [parsedEpisodes, setParsedEpisodes] = useState<{ week: number, results: { chefId: string, chefName: string, quickfire: string, elimination: string, points: number, status: 'active' | 'eliminated' | 'lck' }[] }[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const syncChefsFromWikitext = async () => {
    if (!wikitext) return;
    setIsApplying(true);
    setStatusMessage('Syncing chefs from wikitext...');
    try {
      const rows = wikitext.split(/\|-/);
      const foundNames = new Set<string>();
      
      const cleanWikitext = (text: string) => {
        return text.replace(/\{\{[^}]+\}\}/g, '')
                   .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
                   .replace(/<[^>]+>/g, '') // Remove HTML tags
                   .replace(/&nbsp;/g, ' ')
                   .replace(/[''\[\]!|]/g, '')
                   .trim();
      };

      rows.forEach(row => {
        if (row.includes('ShortSummary') || row.includes('LineColor') || row.includes('EpisodeSummary')) return;
        
        const normalizedRow = row.replace(/\n[|!]/g, ' || ');
        const cells = normalizedRow.split(/\|\||!!/).map(c => c.trim()).filter(c => c !== '');
        if (cells.length < 2) return;
        if (cells.some(c => c.toLowerCase().includes('quickfire challenge'))) return;

        let nameCell = cells[0];
        const cleanFirst = nameCell.replace(/[!|]/g, '').trim();
        if (cleanFirst.match(/^\d+$/) || cleanFirst === '') {
          nameCell = cells[1];
        }

        let name = cleanWikitext(nameCell);
        name = name.replace(/^\d+\s*/, '').trim();
        if (name.length > 2 && name.length <= 30 && !name.toLowerCase().includes('contestant') && !name.toLowerCase().includes('chef') && !name.toLowerCase().includes('episode')) {
          foundNames.add(name);
        }
      });

      let addedCount = 0;
      for (const name of foundNames) {
        const exists = chefs.some(c => c.name.toLowerCase() === name.toLowerCase());
        if (!exists) {
          await addDoc(collection(db, 'chefs'), {
            name,
            hometown: 'Unknown',
            status: 'active',
            totalScore: 0
          });
          addedCount++;
        }
      }

      setStatusMessage(`Sync complete! Added ${addedCount} new chefs.`);
      showStatus('success', `Sync complete! Added ${addedCount} new chefs found in wikitext.`);
    } catch (error) {
      console.error('Sync error:', error);
      setStatusMessage('Sync failed.');
      showStatus('error', 'Error syncing chefs. See console for details.');
    } finally {
      setIsApplying(false);
    }
  };

  const fetchWikitext = async () => {
    if (!url) return;
    setIsFetching(true);
    setStatusMessage('Connecting to proxy...');
    try {
      // Try to convert standard URL to API URL
      let apiUrl = '';
      const titlePart = url.split('/wiki/').pop()?.split('#')[0].split('?')[0];
      const decodedTitle = decodeURIComponent(titlePart || '');
      const isWiki = url.includes('wikipedia.org/wiki/') || url.includes('fandom.com/wiki/');
      const domain = isWiki ? url.split('/wiki/')[0] : '';
      const apiPath = url.includes('wikipedia.org/wiki/') ? '/w/api.php' : '/api.php';

      if (isWiki) {
        apiUrl = `${domain}${apiPath}?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(decodedTitle)}&format=json&origin=*&redirects=1`;
      } else {
        apiUrl = url;
      }

      setStatusMessage(`Fetching page: ${decodedTitle || url}...`);
      console.log('Fetching from API:', apiUrl);
      const response = await fetch(`/api/proxy?url=${encodeURIComponent(apiUrl)}`);
      if (!response.ok) throw new Error(`Failed to fetch from proxy (Status: ${response.status})`);
      
      let data = await response.json();
      console.log('API Response:', data);
      
      if (data.query?.pages) {
        let pageId = Object.keys(data.query.pages)[0];
        let page = data.query.pages[pageId];
        
        // Fallback: If page not found, try searching for it
        if ((pageId === "-1" || page.missing === "" || page.missing === true) && isWiki) {
          setStatusMessage(`Page not found, searching Wikipedia...`);
          console.log(`Page "${decodedTitle}" not found, trying search fallback...`);
          // Try a few search terms
          const searchTerms = [
            "Top Chef Carolinas",
            "Top Chef Season 22",
            "Top Chef (season 22)",
            "Top Chef Carolinas progress",
            "Top Chef 22"
          ];
          
          let searchMatch = null;
          for (const term of searchTerms) {
            setStatusMessage(`Searching for: "${term}"...`);
            console.log(`Searching for: "${term}"`);
            const searchUrl = `${domain}${apiPath}?action=query&list=search&srsearch=${encodeURIComponent(term)}&format=json&origin=*`;
            try {
              const searchResponse = await fetch(`/api/proxy?url=${encodeURIComponent(searchUrl)}`);
              if (!searchResponse.ok) continue;
              const searchData = await searchResponse.json();
              
              if (searchData.query?.search?.length > 0) {
                // Look for a title that contains "Top Chef" and "Season" or "Carolinas"
                const match = searchData.query.search.find((s: any) => {
                  const t = s.title.toLowerCase();
                  return t.includes('top chef') && (t.includes('season') || t.includes('carolinas') || t.includes('22'));
                }) || searchData.query.search[0]; // Fallback to first result if no perfect match
                
                if (match) {
                  searchMatch = match.title;
                  console.log(`Found search match: "${searchMatch}" for term "${term}"`);
                  break;
                }
              }
            } catch (e) {
              console.error(`Search failed for term "${term}":`, e);
            }
          }
          
          if (searchMatch) {
            setStatusMessage(`Found match: "${searchMatch}". Fetching wikitext...`);
            console.log(`Found search match: "${searchMatch}". Fetching wikitext...`);
            const retryUrl = `${domain}${apiPath}?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(searchMatch)}&format=json&origin=*&redirects=1`;
            const retryResponse = await fetch(`/api/proxy?url=${encodeURIComponent(retryUrl)}`);
            data = await retryResponse.json();
            pageId = Object.keys(data.query.pages)[0];
            page = data.query.pages[pageId];
            
            // Update the URL field with the found title
            setUrl(`${domain}/wiki/${searchMatch.replace(/ /g, '_')}`);
          }
        }

        if (pageId === "-1" || page.missing === "" || page.missing === true) {
          setStatusMessage('Page not found.');
          throw new Error(`Page "${decodedTitle}" not found on Wikipedia/Fandom. Check if the URL is correct or try searching for the season manually.`);
        }

        const content = page.revisions?.[0]?.slots?.main?.['*'] || page.revisions?.[0]?.['*'];
        
        if (content) {
          setWikitext(content);
          setStatusMessage('Success! Wikitext loaded.');
          showStatus('success', 'Wikitext fetched successfully!');
        } else {
          setStatusMessage('No content found.');
          console.error('Page data without revisions:', page);
          throw new Error('No content found in API response revisions. The page might be protected or empty.');
        }
      } else {
        // Fallback for non-wiki APIs or direct text responses
        const textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        if (textContent && textContent !== '{}') {
          setWikitext(textContent);
          setStatusMessage('Success! Content loaded.');
          showStatus('success', 'Content fetched successfully!');
        } else {
          setStatusMessage('Empty response.');
          throw new Error('Received empty or invalid response from URL.');
        }
      }
    } catch (error: any) {
      console.error('Fetch error:', error);
      setStatusMessage(`Error: ${error.message}`);
      showStatus('error', `Fetch error: ${error.message || 'Failed to fetch content'}`);
    } finally {
      setIsFetching(false);
    }
  };

  const applyScrapedResults = async () => {
    if (parsedEpisodes.length === 0) return;
    setIsApplying(true);
    try {
      const episode = parsedEpisodes[0]; // We only ever show one episode due to filtering
      
      await runTransaction(db, async (transaction) => {
        for (const res of episode.results) {
          const chefRef = doc(db, 'chefs', res.chefId);

          // 1. Update Chef
          transaction.update(chefRef, {
            totalScore: increment(res.points),
            status: res.status === 'lck' ? 'lck' : (res.status === 'eliminated' ? 'eliminated' : 'active')
          });

          // 2. Create ScoreEvents
          if (res.quickfire !== 'N/A') {
            const qfRef = doc(collection(db, 'scoreEvents'));
            transaction.set(qfRef, {
              chefId: res.chefId,
              week: episode.week,
              type: res.quickfire,
              points: res.quickfirePoints,
              description: `Quickfire: ${res.quickfire}`,
              timestamp: serverTimestamp()
            });
          }

          if (res.elimination !== 'Safe' && res.elimination !== 'N/A' && res.elimination !== 'Already Eliminated' && res.elimination !== 'In LCK') {
            const elRef = doc(collection(db, 'scoreEvents'));
            transaction.set(elRef, {
              chefId: res.chefId,
              week: episode.week,
              type: res.elimination,
              points: res.eliminationPoints,
              description: `Elimination: ${res.elimination}`,
              timestamp: serverTimestamp()
            });
          }

          // 3. Update Players who own this chef
          const owningPlayers = players.filter(p => p.chefIds.includes(res.chefId));
          for (const player of owningPlayers) {
            const playerRef = doc(db, 'players', player.id);
            transaction.update(playerRef, {
              totalScore: increment(res.points)
            });
          }
        }
      });
      showStatus('success', `Successfully applied Episode ${episode.week} results to the database!`);
      setParsedEpisodes([]);
      setWikitext('');
    } catch (error) {
      console.error('Error applying results:', error);
      showStatus('error', 'Failed to apply results. See console for details.');
    } finally {
      setIsApplying(false);
    }
  };

  const parseWikitext = () => {
    setIsParsing(true);
    setParsedEpisodes([]);
    try {
      const rows = wikitext.split(/\|-/);
      const episodeData = new Map<number, Map<string, { quickfire: string, quickfirePoints: number, elimination: string, eliminationPoints: number, eliminated: boolean, lck: boolean }>>();
      
      const maxWeeks = 16;
      for (let w = 1; w <= maxWeeks; w++) {
        episodeData.set(w, new Map());
      }

      const cleanWikitext = (text: string) => {
        return text.replace(/\{\{[^}]+\}\}/g, '')
                   .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
                   .replace(/<[^>]+>/g, '') // Remove HTML tags
                   .replace(/&nbsp;/g, ' ')
                   .replace(/[''\[\]!|]/g, '')
                   .trim();
      };

      const findChef = (name: string) => {
        let clean = cleanWikitext(name);
        clean = clean.replace(/^\d+\s*/, '').trim();
        if (clean.length < 2 || clean.length > 30) return null;
        
        return chefs.find(c => 
          clean.toLowerCase() === c.name.toLowerCase() || 
          clean.toLowerCase().includes(c.name.toLowerCase()) || 
          c.name.toLowerCase().includes(clean.toLowerCase())
        );
      };

      rows.forEach((row) => {
        if (row.includes('ShortSummary') || row.includes('LineColor') || row.includes('EpisodeSummary')) return;
        
        const normalizedRow = row.replace(/\n[|!]/g, ' || ');
        const cells = normalizedRow.split(/\|\||!!/).map(c => c.trim()).filter(c => c !== '');
        if (cells.length < 2) return;

        const isQuickfireRow = cells.some(c => c.toLowerCase().includes('quickfire challenge'));
        
        if (isQuickfireRow) {
          cells.forEach((cell, index) => {
            if (index === 0) return;
            const week = index;
            const lines = cell.split(/<br\s*\/?>|\n/i);
            lines.forEach(line => {
              const text = line.trim();
              if (!text) return;

              let type = '';
              let points = 0;
              if (text.includes('★')) { type = 'Quickfire Win'; points = 5; }
              else if (text.includes('↑')) { type = 'Quickfire Favorite'; points = 2; }
              else if (text.includes('↓')) { type = 'Quickfire Least Favorite'; points = -1; }

              if (type) {
                const nameMatch = text.match(/''([^']+)''/) || text.match(/\{\{color\|[^|]+\|([^}]+)\}\}/i) || [null, text.replace(/[★↑↓]/g, '').trim()];
                const rawName = nameMatch[1] || text.replace(/[★↑↓]/g, '').trim();
                const matchedChef = findChef(rawName);
                
                if (matchedChef) {
                  const weekMap = episodeData.get(week);
                  if (weekMap) {
                    const current = weekMap.get(matchedChef.id) || { quickfire: '', quickfirePoints: 0, elimination: '', eliminationPoints: 0, eliminated: false, lck: false };
                    weekMap.set(matchedChef.id, { ...current, quickfire: type, quickfirePoints: current.quickfirePoints + points });
                  }
                }
              }
            });
          });
        } else {
          let nameCell = cells[0];
          let scoreStartIndex = 1;
          const cleanFirst = nameCell.replace(/[!|]/g, '').trim();
          if (cleanFirst.match(/^\d+$/) || cleanFirst === '') {
            nameCell = cells[1];
            scoreStartIndex = 2;
          }

          const matchedChef = findChef(nameCell);
          if (matchedChef) {
            let currentWeek = 1;
            // Skip metadata columns (like Hometown) before the first score cell
            let firstScoreIndex = scoreStartIndex;
            while (firstScoreIndex < cells.length) {
              const cellUpper = cells[firstScoreIndex].toUpperCase();
              if (cellUpper.includes('IN') || cellUpper.includes('WIN') || cellUpper.includes('HIGH') || 
                  cellUpper.includes('LOW') || cellUpper.includes('OUT') || cellUpper.includes('ELIM') || 
                  cellUpper.includes('LCK') || cellUpper.includes('SAFE')) {
                break;
              }
              firstScoreIndex++;
            }

            cells.slice(firstScoreIndex).forEach((cell) => {
              // Handle colspan
              let span = 1;
              const spanMatch = cell.match(/colspan="?(\d+)"?/i);
              if (spanMatch) span = parseInt(spanMatch[1]);

              const cellNoTemplates = cell.replace(/\{\{[^}]+\}\}/g, '');
              const cellUpper = cellNoTemplates.toUpperCase();
              let cellContent = cellNoTemplates;
              if (cellContent.includes('|')) {
                cellContent = cellContent.split('|').pop()?.trim() || '';
              }
              const upperCell = cellContent.toUpperCase();
              
              let type = '';
              let points = 0;
              let eliminated = false;
              let inLCK = false;

              if (upperCell.includes('WINNER')) { type = 'Winner'; points = 30; }
              else if (upperCell.includes('RUNNER-UP')) { type = 'Runner-Up'; points = 15; }
              else if (upperCell.includes('LCK WIN') || upperCell.includes('LAST CHANCE KITCHEN WIN')) { type = 'Last Chance Kitchen Win'; points = 2; inLCK = true; }
              else if (upperCell.includes('WIN')) { type = 'Elimination Win'; points = 7; }
              else if (upperCell.includes('HIGH')) { type = 'Top'; points = 4; }
              else if (upperCell.includes('LOW')) { type = 'Bottom'; points = -2; }
              else if (upperCell.includes('OUT') || upperCell.includes('ELIM')) { type = 'Eliminated'; points = -2; eliminated = true; }
              else if (upperCell === 'IN' || upperCell === 'SAFE') { type = 'Safe'; points = 0; }
              else if (upperCell.includes('LCK')) { type = 'In LCK'; points = 0; inLCK = true; }
              
              const isDarkGrey = cellUpper.includes('DARKGREY') || cellUpper.includes('DARKGRAY');
              if (isDarkGrey) eliminated = true;

              for (let s = 0; s < span; s++) {
                const week = currentWeek + s;
                if (week > maxWeeks) break;

                const weekMap = episodeData.get(week);
                if (weekMap) {
                  const current = weekMap.get(matchedChef.id) || { quickfire: '', quickfirePoints: 0, elimination: '', eliminationPoints: 0, eliminated: false, lck: false };
                  
                  // Only award points on the first week of a colspan, and only if they weren't already eliminated in a previous week
                  let wasEliminatedPreviously = false;
                  for (let prevW = 1; prevW < week; prevW++) {
                    if (episodeData.get(prevW)?.get(matchedChef.id)?.eliminated) {
                      wasEliminatedPreviously = true;
                      break;
                    }
                  }

                  if (s === 0 || eliminated || isDarkGrey || inLCK) {
                    const finalType = (eliminated || isDarkGrey) ? (wasEliminatedPreviously ? 'Already Eliminated' : 'Eliminated') : (inLCK ? 'In LCK' : (s === 0 ? type : 'N/A'));
                    const finalPoints = (s === 0 && !wasEliminatedPreviously) ? points : 0;
                    
                    weekMap.set(matchedChef.id, { 
                      ...current, 
                      elimination: finalType || current.elimination, 
                      eliminationPoints: current.eliminationPoints + finalPoints, 
                      eliminated: current.eliminated || eliminated || isDarkGrey,
                      lck: current.lck || inLCK
                    });
                  }
                }
              }
              currentWeek += span;
            });
          }
        }
      });

      const finalEpisodes = [];
      for (let w = 1; w <= maxWeeks; w++) {
        const weekMap = episodeData.get(w);
        if (!weekMap) continue;

        chefs.forEach(chef => {
          if (!weekMap.has(chef.id)) {
            let wasEliminated = false;
            let wasInLCK = false;
            for (let prevW = 1; prevW < w; prevW++) {
              const prevData = episodeData.get(prevW)?.get(chef.id);
              if (prevData?.eliminated) wasEliminated = true;
              if (prevData?.lck) wasInLCK = true;
            }
            weekMap.set(chef.id, {
              quickfire: 'N/A',
              quickfirePoints: 0,
              elimination: wasEliminated ? (wasInLCK ? 'In LCK' : 'Already Eliminated') : 'Safe',
              eliminationPoints: 0,
              eliminated: wasEliminated,
              lck: wasInLCK
            });
          }
        });

        const results = Array.from(weekMap.entries()).map(([chefId, data]) => ({
          chefId,
          chefName: chefs.find(c => c.id === chefId)?.name || 'Unknown',
          quickfire: data.quickfire || 'N/A',
          quickfirePoints: data.quickfirePoints,
          elimination: data.elimination || 'N/A',
          eliminationPoints: data.eliminationPoints,
          points: data.quickfirePoints + data.eliminationPoints,
          status: data.lck ? 'lck' as const : (data.eliminated ? 'eliminated' as const : 'active' as const)
        })).sort((a, b) => b.points - a.points || a.chefName.localeCompare(b.chefName));

        if (results.some(r => r.quickfire !== 'N/A' || r.elimination !== 'Safe' || r.status === 'eliminated')) {
          finalEpisodes.push({ week: w, results });
        }
      }

      setParsedEpisodes(finalEpisodes.filter(ep => ep.week === selectedWeek));
      if (finalEpisodes.length === 0) showStatus('error', 'No matching chefs found.');
      else if (!finalEpisodes.some(ep => ep.week === selectedWeek)) {
        showStatus('error', `No data found for Episode ${selectedWeek}. Please check your selection or the wikitext.`);
      }
    } catch (error) {
      console.error('Parsing error:', error);
      showStatus('error', 'Error parsing wikitext. See console for details.');
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-stone-400 tracking-wider flex items-center gap-2">
            <Globe className="w-3 h-3" />
            Quick Select Season (Wikipedia)
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {TOP_CHEF_SEASONS.map((season) => (
              <button
                key={season.url}
                onClick={() => setUrl(season.url)}
                className={`text-[10px] font-bold px-3 py-2 rounded-lg border transition-all ${
                  url === season.url 
                    ? 'bg-orange-600 border-orange-600 text-white shadow-md' 
                    : 'bg-white border-stone-200 text-stone-600 hover:border-orange-500 hover:text-orange-600'
                }`}
              >
                {season.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-stone-400 tracking-wider flex items-center gap-2">
            <Link className="w-3 h-3" />
            Custom URL (Wikipedia or Fandom)
          </label>
          <div className="flex gap-2">
            <input 
              type="text" 
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://en.wikipedia.org/wiki/Top_Chef_(season_21)"
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <button 
              onClick={fetchWikitext}
              disabled={!url || isFetching}
              className="bg-stone-900 text-white px-6 py-2 rounded-xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {isFetching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link className="w-4 h-4" />}
              {isFetching ? 'Fetching...' : 'Fetch'}
            </button>
          </div>
          {statusMessage && (
            <p className="text-[10px] font-bold text-orange-600 animate-pulse">
              {statusMessage}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-stone-400 tracking-wider flex items-center gap-2">
            <FileText className="w-3 h-3" />
            Wikipedia Wikitext (Progress Chart Section)
          </label>
          <textarea 
            value={wikitext}
            onChange={(e) => setWikitext(e.target.value)}
            placeholder="Paste the wikitext from the Wikipedia edit box here..."
            className="w-full h-48 p-4 bg-stone-50 border border-stone-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-orange-500 outline-none"
          />
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold uppercase text-stone-400">Episode to Scrape:</label>
                <select 
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(parseInt(e.target.value))}
                  className="bg-white border border-stone-200 rounded-lg px-3 py-1 text-sm font-bold focus:ring-2 focus:ring-orange-500 outline-none"
                >
                  {[...Array(16)].map((_, i) => (
                    <option key={i + 1} value={i + 1}>Episode {i + 1}</option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] text-stone-400 italic">
                Tip: Copy the entire "Contestant progress" table from the Wikipedia edit screen.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={syncChefsFromWikitext}
                disabled={!wikitext || isApplying}
                className="bg-stone-100 text-stone-600 px-4 py-2 rounded-xl font-bold hover:bg-stone-200 transition-all disabled:opacity-50 flex items-center gap-2 text-xs"
              >
                <RefreshCw className={`w-3 h-3 ${isApplying ? 'animate-spin' : ''}`} />
                Sync Chefs
              </button>
              <button 
                onClick={parseWikitext}
                disabled={!wikitext || isParsing}
                className="bg-stone-900 text-white px-6 py-2 rounded-xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                <Search className="w-4 h-4" />
                {isParsing ? 'Parsing...' : 'Parse & Preview'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {parsedEpisodes.length > 0 && (
        <div className="space-y-8 animate-in fade-in slide-in-from-top-4 duration-500">
          {parsedEpisodes.map((episode) => (
            <div key={episode.week} className="space-y-4">
              <div className="flex items-center gap-2 text-stone-900 font-bold border-b border-stone-200 pb-2">
                <TableIcon className="w-5 h-5 text-orange-600" />
                Episode {episode.week} Results
              </div>
              <div className="overflow-x-auto rounded-xl border border-stone-200">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200">
                      <th className="p-3 text-[10px] font-bold uppercase text-stone-500">Chef</th>
                      <th className="p-3 text-[10px] font-bold uppercase text-stone-500">Quickfire</th>
                      <th className="p-3 text-[10px] font-bold uppercase text-stone-500">Elimination</th>
                      <th className="p-3 text-[10px] font-bold uppercase text-stone-500">Status</th>
                      <th className="p-3 text-[10px] font-bold uppercase text-stone-500 text-right">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {episode.results.map((res, i) => (
                      <tr key={i} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/50 transition-colors">
                        <td className="p-3 font-bold text-stone-900 text-sm">{res.chefName}</td>
                        <td className="p-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            res.quickfire.includes('Win') ? 'bg-green-100 text-green-700' :
                            res.quickfire.includes('Favorite') ? 'bg-blue-100 text-blue-700' :
                            res.quickfire.includes('Least') ? 'bg-red-100 text-red-700' :
                            'bg-stone-100 text-stone-400'
                          }`}>
                            {res.quickfire}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            res.elimination.includes('Win') || res.elimination.includes('Winner') ? 'bg-green-100 text-green-700' :
                            res.elimination.includes('Top') || res.elimination.includes('Runner-Up') ? 'bg-blue-100 text-blue-700' :
                            res.elimination.includes('Bottom') ? 'bg-orange-100 text-orange-700' :
                            res.elimination.includes('Eliminated') ? 'bg-red-100 text-red-700' :
                            'bg-stone-100 text-stone-400'
                          }`}>
                            {res.elimination}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`text-[10px] font-bold ${
                            res.status === 'active' ? 'text-green-600' : 
                            res.status === 'lck' ? 'text-blue-600' : 
                            'text-red-600'
                          }`}>
                            {res.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-3 text-right font-black text-orange-600 text-sm">
                          {res.points > 0 ? `+${res.points}` : res.points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="text-[10px] text-stone-400 bg-stone-50 p-3 rounded-lg border border-stone-100">
            <strong>Note:</strong> Verify the data above carefully. Clicking "Apply to Database" will update scores for all chefs and players in the league.
          </p>
          <button 
            onClick={applyScrapedResults}
            disabled={isApplying}
            className="w-full bg-orange-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-orange-700 transition-all shadow-xl shadow-orange-200 flex items-center justify-center gap-3"
          >
            {isApplying ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Applying Results...
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" />
                Apply Episode {parsedEpisodes[0].week} to Database
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function AdminView({ chefs, players, seedData, config, onAutoDraft, onFullAutoDraft, isSubmittingApp, proxyPlayerId, setProxyPlayerId }: { 
  chefs: Chef[], 
  players: Player[], 
  seedData: () => void, 
  config: LeagueConfig | null,
  onAutoDraft: () => Promise<void>,
  onFullAutoDraft: () => Promise<void>,
  isSubmittingApp: boolean,
  proxyPlayerId: string,
  setProxyPlayerId: (id: string) => void
}) {
  const [selectedChefId, setSelectedChefId] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>(SCORING_RULES[0].type);
  const [week, setWeek] = useState(2);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bulkNames, setBulkNames] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);

  const showStatus = (type: 'success' | 'error' | 'info', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const handleBulkRename = async () => {
    const names = bulkNames.split('\n').map(n => n.trim()).filter(n => n !== '');
    if (names.length === 0) return;

    setIsSubmitting(true);
    try {
      // Sort chefs by current name to have a predictable order for bulk renaming
      const sortedChefs = [...chefs].sort((a, b) => a.name.localeCompare(b.name));
      const promises = sortedChefs.map((chef, index) => {
        if (names[index]) {
          return updateDoc(doc(db, 'chefs', chef.id), { name: names[index] });
        }
        return Promise.resolve();
      });
      await Promise.all(promises);
      showStatus('success', 'Chefs renamed successfully!');
      setBulkNames('');
    } catch (error) {
      showStatus('error', 'Failed to rename chefs.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddScore = async () => {
    if (!selectedChefId || isSubmitting) return;
    setIsSubmitting(true);

    const rule = SCORING_RULES.find(r => r.type === selectedType);
    if (!rule) return;

    try {
      await runTransaction(db, async (transaction) => {
        // Add Score Event
        const eventRef = doc(collection(db, 'scoreEvents'));
        transaction.set(eventRef, {
          chefId: selectedChefId,
          week,
          type: selectedType,
          points: rule.points,
          timestamp: serverTimestamp(),
          description: `${selectedType} - Week ${week}`
        });

        // Update Chef Score
        const chefRef = doc(db, 'chefs', selectedChefId);
        transaction.update(chefRef, {
          totalScore: increment(rule.points),
          status: selectedType === 'Eliminated' ? 'eliminated' : 'active'
        });

        // Update Player Score (if chef is owned)
        const player = players.find(p => p.chefIds.includes(selectedChefId));
        if (player) {
          const playerRef = doc(db, 'players', player.id);
          transaction.update(playerRef, {
            totalScore: increment(rule.points)
          });
        }
      });
      showStatus('success', 'Score updated successfully!');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, 'scoreEvents');
      showStatus('error', 'Score update failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateChefName = async (id: string, name: string) => {
    await updateDoc(doc(db, 'chefs', id), { name });
  };

  const toggleRankings = async () => {
    if (!config) return;
    const configRef = doc(db, 'config', 'league');
    await updateDoc(configRef, { rankingsOpen: !config.rankingsOpen });
  };

  const randomizeDraftOrder = async () => {
    if (!config || config.draftStarted || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const newOrder = [...config.draftOrder].sort(() => Math.random() - 0.5);
      await updateDoc(doc(db, 'config', 'league'), {
        draftOrder: newOrder
      });
      showStatus('success', 'Draft order randomized!');
    } catch (error) {
      showStatus('error', 'Failed to randomize draft order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');

  const handleMergePlayers = async () => {
    if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      const source = players.find(p => p.id === mergeSourceId);
      const target = players.find(p => p.id === mergeTargetId);
      
      if (!source || !target) throw new Error("Players not found");

      await runTransaction(db, async (transaction) => {
        const sourceRef = doc(db, 'players', source.id);
        const targetRef = doc(db, 'players', target.id);
        const configRef = doc(db, 'config', 'league');

        // Merge rankings (unique)
        const combinedRankings = Array.from(new Set([...(target.rankings || []), ...(source.rankings || [])]));
        // Merge chefs
        const combinedChefs = Array.from(new Set([...(target.chefIds || []), ...(source.chefIds || [])]));
        
        transaction.update(targetRef, {
          rankings: combinedRankings,
          chefIds: combinedChefs,
          totalScore: (target.totalScore || 0) + (source.totalScore || 0)
        });

        // Update draft order
        const newDraftOrder = config!.draftOrder.map(id => id === source.id ? target.id : id);
        transaction.update(configRef, { draftOrder: newDraftOrder });

        // Delete source
        transaction.delete(sourceRef);
      });

      showStatus('success', 'Players merged successfully!');
      setMergeSourceId('');
      setMergeTargetId('');
    } catch (error) {
      console.error(error);
      showStatus('error', 'Merge failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const proxyPlayer = players.find(p => p.id === proxyPlayerId);

  const [inviteCode, setInviteCode] = useState(config?.inviteCode || '');

  const updateInviteCode = async () => {
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'config', 'league'), { inviteCode });
      showStatus('success', 'Invite code updated!');
    } catch (error) {
      showStatus('error', 'Failed to update invite code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearScores = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const target = e.currentTarget;
    if (target.dataset.confirm !== 'true') {
      target.dataset.confirm = 'true';
      const originalText = target.innerText;
      target.innerText = 'Click again to confirm';
      target.classList.add('bg-red-600', 'text-white');
      target.classList.remove('bg-white', 'text-red-600');
      setTimeout(() => {
        if (target) {
          target.dataset.confirm = 'false';
          target.innerText = originalText;
          target.classList.remove('bg-red-600', 'text-white');
          target.classList.add('bg-white', 'text-red-600');
        }
      }, 3000);
      return;
    }
    
    setIsSubmitting(true);
    try {
      await runTransaction(db, async (transaction) => {
        // 1. Delete all score events
        const scoreEventsSnap = await getDocs(collection(db, 'scoreEvents'));
        scoreEventsSnap.docs.forEach(doc => {
          transaction.delete(doc.ref);
        });

        // 2. Reset chefs
        const chefsSnap = await getDocs(collection(db, 'chefs'));
        chefsSnap.docs.forEach(doc => {
          transaction.update(doc.ref, { totalScore: 0, status: 'active' });
        });

        // 3. Reset players
        const playersSnap = await getDocs(collection(db, 'players'));
        playersSnap.docs.forEach(doc => {
          transaction.update(doc.ref, { totalScore: 0 });
        });
      });
      showStatus('success', 'All scores have been reset successfully.');
    } catch (error) {
      console.error("Error clearing scores:", error);
      showStatus('error', 'Failed to clear scores.');
    } finally {
      setIsSubmitting(false);
      target.dataset.confirm = 'false';
      target.innerText = 'Clear All Scores';
      target.classList.remove('bg-red-600', 'text-white');
      target.classList.add('bg-white', 'text-red-600');
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {status && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-xl border flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300 ${
          status.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
          status.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
          'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          {status.type === 'success' && <Trophy className="w-5 h-5" />}
          {status.type === 'error' && <AlertCircle className="w-5 h-5" />}
          {status.type === 'info' && <RefreshCw className="w-5 h-5 animate-spin" />}
          <span className="font-bold text-sm">{status.message}</span>
          <button onClick={() => setStatus(null)} className="ml-2 opacity-50 hover:opacity-100">×</button>
        </div>
      )}

      {/* League Security */}
      <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <ChefHat className="w-5 h-5 text-orange-600" />
          <h3 className="text-lg font-black text-stone-900 uppercase tracking-tight">League Security</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase text-stone-400 mb-1 ml-1">Invite Code (Password to Join)</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="e.g. TOPCHEF2024"
                className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button 
                onClick={updateInviteCode}
                disabled={isSubmitting}
                className="bg-stone-900 text-white px-6 py-2 rounded-xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50"
              >
                Save
              </button>
            </div>
            <p className="text-[10px] text-stone-400 mt-2 italic">
              New players will be asked for this code before they can join the league.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-8 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">League Controls</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <button 
            onClick={seedData}
            disabled={isSubmitting}
            className="flex items-center justify-center gap-2 bg-stone-100 text-stone-600 p-4 rounded-xl font-bold hover:bg-stone-200 transition-all disabled:opacity-50 min-h-[44px]"
          >
            <RefreshCw className="w-5 h-5" />
            Reset League
          </button>
          <button 
            onClick={randomizeDraftOrder}
            disabled={isSubmitting || config?.draftStarted}
            className="flex items-center justify-center gap-2 bg-stone-100 text-stone-600 p-4 rounded-xl font-bold hover:bg-stone-200 transition-all disabled:opacity-50 min-h-[44px]"
          >
            <Dice5 className="w-5 h-5" />
            Randomize Order
          </button>
          <button 
            onClick={toggleRankings}
            className={`flex items-center justify-center gap-2 p-4 rounded-xl font-bold transition-all min-h-[44px] ${
              config?.rankingsOpen ? 'bg-orange-100 text-orange-600 hover:bg-orange-200' : 'bg-stone-100 text-stone-400 hover:bg-stone-200'
            }`}
          >
            <ListOrdered className="w-5 h-5" />
            {config?.rankingsOpen ? 'Close Rankings' : 'Open Rankings'}
          </button>
          <button 
            onClick={onAutoDraft}
            disabled={isSubmittingApp || config?.draftCompleted || !config?.draftStarted}
            className="flex items-center justify-center gap-2 bg-stone-900 text-white p-4 rounded-xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50 min-h-[44px]"
          >
            <Zap className="w-5 h-5" />
            Auto-Draft Next
          </button>
          <button 
            onClick={onFullAutoDraft}
            disabled={isSubmittingApp || config?.draftCompleted}
            className="flex items-center justify-center gap-2 bg-orange-600 text-white p-4 rounded-xl font-bold hover:bg-orange-700 transition-all disabled:opacity-50 min-h-[44px]"
          >
            <Zap className="w-5 h-5" />
            Run Full Auto-Draft
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-8 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Manage Player Rankings</h2>
        <p className="text-stone-500 text-sm mb-4">Select a player to edit their rankings on their behalf. Useful for players who haven't logged in yet.</p>
        <select 
          value={proxyPlayerId} 
          onChange={(e) => setProxyPlayerId(e.target.value)}
          className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none min-h-[44px] mb-6"
        >
          <option value="">Select Player to Manage</option>
          {players.map(p => (
            <option key={p.id} value={p.id}>{p.name} {p.email ? `(${p.email})` : '(Not Logged In)'}</option>
          ))}
        </select>

        {proxyPlayer && (
          <div className="border-t border-stone-100 pt-6">
            <RankingView 
              chefs={chefs} 
              player={proxyPlayer} 
              players={players}
              config={config}
              isAdmin={true}
            />
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-8 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Invite Players (Claim Links)</h2>
        <p className="text-stone-500 text-sm mb-6">Send these links to players who haven't joined yet. This ensures they claim the correct pre-seeded profile instead of creating a duplicate.</p>
        <div className="space-y-3">
          {players.filter(p => !p.email).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
            <div key={p.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-stone-50 rounded-xl border border-stone-100 group gap-4">
              <div>
                <div className="font-bold text-stone-900">{p.name}</div>
                <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">Unclaimed Profile</div>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <input 
                  type="email"
                  placeholder="Auto-link email address..."
                  defaultValue={p.prefilledEmail || ''}
                  onBlur={async (e) => {
                    const val = e.target.value.trim();
                    if (val !== (p.prefilledEmail || '')) {
                      try {
                        await updateDoc(doc(db, 'players', p.id), { prefilledEmail: val });
                        showStatus('success', `Email linked for ${p.name}`);
                      } catch (err) {
                        showStatus('error', 'Failed to link email');
                      }
                    }
                  }}
                  className="text-xs px-3 py-2 border border-stone-200 rounded-lg w-full sm:w-48 focus:outline-none focus:border-orange-500"
                />
                <button 
                  onClick={() => {
                    const claimUrl = `${window.location.origin}${window.location.pathname}?claim=${p.id}`;
                    navigator.clipboard.writeText(claimUrl);
                    showStatus('success', `Link copied for ${p.name}!`);
                  }}
                  className="flex items-center justify-center gap-2 bg-white border border-stone-200 text-stone-600 px-4 py-2 rounded-lg text-xs font-bold hover:border-orange-500 hover:text-orange-600 transition-all shadow-sm w-full sm:w-auto"
                >
                  <Send className="w-3.5 h-3.5" />
                  Copy Link
                </button>
              </div>
            </div>
          ))}
          {players.filter(p => !p.email).length === 0 && (
            <div className="text-center py-8 text-stone-400 italic text-sm">
              All players have claimed their profiles!
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-8 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Merge Duplicate Players</h2>
        <p className="text-stone-500 text-sm mb-4">If a player has two profiles (e.g. one from seeding and one from logging in), use this to merge them. Source will be deleted.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-end">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-stone-400 tracking-wider">Source (Old/Duplicate)</label>
            <select 
              value={mergeSourceId} 
              onChange={(e) => setMergeSourceId(e.target.value)}
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none min-h-[44px]"
            >
              <option value="">Select Source</option>
              {players.map(p => (
                <option key={p.id} value={p.id}>{p.name} {p.email ? `(${p.email})` : '(No Email)'}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-stone-400 tracking-wider">Target (Keep/Logged In)</label>
            <select 
              value={mergeTargetId} 
              onChange={(e) => setMergeTargetId(e.target.value)}
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none min-h-[44px]"
            >
              <option value="">Select Target</option>
              {players.map(p => (
                <option key={p.id} value={p.id}>{p.name} {p.email ? `(${p.email})` : '(No Email)'}</option>
              ))}
            </select>
          </div>
          <button 
            onClick={handleMergePlayers}
            disabled={!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId || isSubmitting}
            className="bg-stone-900 text-white p-3 rounded-xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50 min-h-[44px]"
          >
            Merge Players
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-8 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Scoring Scraper (Beta)</h2>
        <ScraperTool chefs={chefs} players={players} showStatus={showStatus} />
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-8 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Update Scores</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-stone-400 tracking-wider">Chef</label>
            <select 
              value={selectedChefId} 
              onChange={(e) => setSelectedChefId(e.target.value)}
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none min-h-[44px]"
            >
              <option value="">Select Chef</option>
              {[...chefs].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-stone-400 tracking-wider">Event</label>
            <select 
              value={selectedType} 
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none min-h-[44px]"
            >
              {SCORING_RULES.map(r => (
                <option key={r.type} value={r.type}>{r.type} ({r.points > 0 ? '+' : ''}{r.points})</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-stone-400 tracking-wider">Week</label>
            <input 
              type="number" 
              value={week} 
              onChange={(e) => setWeek(parseInt(e.target.value))}
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none min-h-[44px]"
            />
          </div>
          <button 
            onClick={handleAddScore}
            disabled={!selectedChefId || isSubmitting}
            className="bg-stone-900 text-white p-3 rounded-xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50 min-h-[44px]"
          >
            {isSubmitting ? 'Updating...' : 'Add Points'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-8 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Manage Chefs</h2>
        
        <div className="mb-8 p-4 sm:p-6 bg-stone-50 rounded-xl border border-stone-200 space-y-4">
          <h3 className="font-bold text-sm uppercase tracking-wider text-stone-500">Bulk Rename Chefs</h3>
          <p className="text-xs text-stone-400">Paste a list of names (one per line) to rename all placeholder chefs at once.</p>
          <textarea 
            value={bulkNames}
            onChange={(e) => setBulkNames(e.target.value)}
            placeholder="Chef Name 1&#10;Chef Name 2&#10;..."
            className="w-full h-32 p-3 bg-white border border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none font-mono text-sm"
          />
          <button 
            onClick={handleBulkRename}
            disabled={isSubmitting || !bulkNames.trim()}
            className="w-full bg-stone-900 text-white p-3 rounded-xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50 min-h-[44px]"
          >
            Apply Bulk Names
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {[...chefs].sort((a, b) => a.name.localeCompare(b.name)).map(chef => (
            <div key={chef.id} className="p-3 sm:p-4 border border-stone-100 rounded-xl flex items-center gap-3 relative group">
              <input 
                type="text" 
                defaultValue={chef.name}
                onBlur={(e) => updateChefName(chef.id, e.target.value)}
                className="font-bold bg-transparent outline-none focus:text-orange-600 w-full text-sm sm:text-base pr-6"
              />
              <select
                value={chef.status}
                onChange={async (e) => {
                  try {
                    await updateDoc(doc(db, 'chefs', chef.id), { status: e.target.value });
                    showStatus('success', 'Status updated.');
                  } catch (err) {
                    showStatus('error', 'Failed to update status.');
                  }
                }}
                className={`shrink-0 text-[10px] px-2 py-1 rounded-full uppercase font-black outline-none cursor-pointer appearance-none text-center ${
                  chef.status === 'active' ? 'bg-green-100 text-green-600' : 
                  chef.status === 'lck' ? 'bg-yellow-100 text-yellow-600' : 
                  'bg-red-100 text-red-600'
                }`}
              >
                <option value="active">Active</option>
                <option value="eliminated">Eliminated</option>
                <option value="lck">LCK</option>
              </select>
              <button 
                onClick={async (e) => {
                  const target = e.currentTarget;
                  if (target.dataset.confirm === 'true') {
                    try {
                      await deleteDoc(doc(db, 'chefs', chef.id));
                      showStatus('success', 'Chef deleted.');
                    } catch (err) {
                      showStatus('error', 'Failed to delete chef.');
                    }
                  } else {
                    target.dataset.confirm = 'true';
                    target.classList.add('text-white', 'bg-red-500');
                    target.classList.remove('text-red-500', 'hover:bg-red-50');
                    setTimeout(() => {
                      if (target) {
                        target.dataset.confirm = 'false';
                        target.classList.remove('text-white', 'bg-red-500');
                        target.classList.add('text-red-500', 'hover:bg-red-50');
                      }
                    }, 3000);
                  }
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-50 rounded transition-all"
                title="Delete Chef (Click twice to confirm)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-stone-50 border border-stone-200 rounded-2xl p-6 sm:p-8 text-center space-y-4">
        <RefreshCw className="w-10 h-10 sm:w-12 sm:h-12 text-stone-400 mx-auto" />
        <h3 className="text-lg sm:text-xl font-bold">League Management</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div className="p-4 bg-white rounded-xl border border-stone-200 space-y-3">
            <h4 className="font-bold text-stone-900">Clear Scores</h4>
            <p className="text-stone-500 text-xs">Removes all score events and resets everyone to 0 points. Keeps players and drafts intact.</p>
            <button 
              onClick={handleClearScores} 
              disabled={isSubmitting}
              className="w-full bg-orange-100 text-orange-800 px-4 py-2 rounded-lg font-bold hover:bg-orange-200 transition-all text-sm disabled:opacity-50"
            >
              Clear All Scores
            </button>
          </div>
          
          <div className="p-4 bg-white rounded-xl border border-stone-200 space-y-3">
            <h4 className="font-bold text-stone-900">Hard Reset</h4>
            <p className="text-stone-500 text-xs">Deletes EVERYTHING (players, drafts, scores) and re-seeds the initial chefs.</p>
            <button 
              onClick={seedData} 
              disabled={isSubmitting}
              className="w-full bg-red-100 text-red-800 px-4 py-2 rounded-lg font-bold hover:bg-red-200 transition-all text-sm disabled:opacity-50"
            >
              {chefs.length === 0 ? 'Seed League Data' : 'Reset & Re-Seed League'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
