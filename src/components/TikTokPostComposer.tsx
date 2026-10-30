import React from 'react';
import {View,Text,Linking} from 'react-native';
import {DMButton} from './DMButton';
export default function TikTokPostComposer({visible,onClose}:{visible:boolean;onClose:()=>void;orgId?:string}) {
  if(!visible)return null;
  return <View><Text>Review and post your TikTok video from the Dotti web dashboard.</Text><DMButton title="Open web dashboard" onPress={()=>void Linking.openURL('https://dottmediaapk.web.app/')}/><DMButton title="Close" onPress={onClose}/></View>;
}
